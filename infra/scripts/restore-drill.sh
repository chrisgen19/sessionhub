#!/usr/bin/env bash
# Only creates/restores/removes its own disposable container; no production target argument.
set -euo pipefail
umask 077
if [[ $# != 2 ]]; then
  echo 'Usage: restore-drill.sh <backup.dump.age> <age-private-identity-file>' >&2
  exit 2
fi
archive=$1
identity=$2
[[ -s "$archive" && -r "$identity" ]] || { echo 'Backup or identity is unreadable' >&2; exit 2; }
command -v age >/dev/null
command -v docker >/dev/null
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
drill_container=''
cleanup() {
  if [[ -n "$drill_container" ]]; then docker rm -fv "$drill_container" >/dev/null; fi
}
trap cleanup EXIT
# No published ports/network and ephemeral storage. Only trust archives from our own database.
drill_container=$(docker create --network none --tmpfs /var/lib/postgresql \
  -e POSTGRES_USER=sessionhub -e POSTGRES_DB=sessionhub_drill -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine)
docker start "$drill_container" >/dev/null
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$drill_container" pg_isready -h 127.0.0.1 -U sessionhub -d sessionhub_drill >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Drill PostgreSQL did not become ready' >&2; exit 1; }
age --decrypt --identity "$identity" "$archive" |
  docker exec -i "$drill_container" pg_restore -U sessionhub -d sessionhub_drill \
    --no-owner --no-acl --exit-on-error --single-transaction
# Restored foreign keys/unique constraints must be validated and migrations complete.
validation=$(docker exec "$drill_container" psql -X -U sessionhub -d sessionhub_drill -At -v ON_ERROR_STOP=1 -c '
SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) > 0
   AND NOT EXISTS (SELECT FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)
   AND NOT EXISTS (SELECT FROM pg_constraint WHERE connamespace = '\''public'\''::regnamespace AND NOT convalidated)
   AND (SELECT count(*) FROM saved_sessions) >= 0
   AND (SELECT count(*) FROM saved_session_tabs) >= 0
   AND (SELECT count(*) FROM sync_changes) >= 0
   AND (SELECT count(*) FROM sync_operation_receipts) >= 0;')
[[ "$validation" == t ]] || { echo 'Restored schema/invariants failed' >&2; exit 1; }
if [[ -n "${DRILL_EXPECT_FINGERPRINT:-}" ]]; then
  # Optional exact check for a quiescent fixture or a fingerprint from the backup snapshot.
  actual=$(docker exec -i "$drill_container" psql -X -U sessionhub -d sessionhub_drill -At -v ON_ERROR_STOP=1 < "$script_dir/database-fingerprint.sql")
  [[ "$actual" == "$(cat "$DRILL_EXPECT_FINGERPRINT")" ]] || { echo 'Restored data differs from expected fingerprint' >&2; exit 1; }
fi
echo 'Restore drill passed: authenticated decryption, schema, migrations and constraints verified.'
