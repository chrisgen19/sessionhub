#!/usr/bin/env bash
# Run against a migrated, populated, QUIESCENT TEST database only; never a live production DB.
set -euo pipefail
umask 077
[[ $# == 2 && "$2" == *_test ]] || { echo 'Usage: test-backup.sh <container> <database ending _test>' >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
backup_test_dir=$(mktemp -d)
trap 'rm -rf "$backup_test_dir"' EXIT
age-keygen -o "$backup_test_dir/identity" 2>/dev/null
age-keygen -y "$backup_test_dir/identity" > "$backup_test_dir/recipients"
docker exec -i "$1" sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1' sh "$2" \
  < "$script_dir/database-fingerprint.sql" > "$backup_test_dir/expected"
"$script_dir/backup-postgres.sh" "$1" "$2" "$backup_test_dir/recipients" "$backup_test_dir/backup.dump.age"
DRILL_EXPECT_FINGERPRINT="$backup_test_dir/expected" "$script_dir/restore-drill.sh" "$backup_test_dir/backup.dump.age" "$backup_test_dir/identity"
if "$script_dir/backup-postgres.sh" "$1" "$2" "$backup_test_dir/recipients" "$backup_test_dir/backup.dump.age"; then
  echo 'Overwrite was allowed' >&2; exit 1
fi
# Corruption must fail authentication/restore and the temporary target must be cleaned up.
cp "$backup_test_dir/backup.dump.age" "$backup_test_dir/corrupt.dump.age"
printf 'broken' | dd of="$backup_test_dir/corrupt.dump.age" bs=1 seek=180 conv=notrunc 2>/dev/null
if "$script_dir/restore-drill.sh" "$backup_test_dir/corrupt.dump.age" "$backup_test_dir/identity"; then
  echo 'Corrupt archive was accepted' >&2; exit 1
fi
# A failed dump must never publish a seemingly successful encrypted archive.
if "$script_dir/backup-postgres.sh" "$1" missing_m6_database "$backup_test_dir/recipients" "$backup_test_dir/failed.dump.age"; then
  echo 'Failed dump was accepted' >&2; exit 1
fi
[[ ! -e "$backup_test_dir/failed.dump.age" ]]
echo 'Backup tests passed, including overwrite, corruption and dump-failure paths.'
