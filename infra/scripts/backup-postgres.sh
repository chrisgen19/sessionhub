#!/usr/bin/env bash
# Read-only dump from an existing container; plaintext never touches the host filesystem.
set -euo pipefail
umask 077
if [[ $# != 4 ]]; then
  echo 'Usage: backup-postgres.sh <postgres-container> <database> <age-recipients-file> <new-output.dump.age>' >&2
  exit 2
fi
source_container=$1
source_database=$2
recipients=$3
output=$4
[[ "$source_database" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo 'Invalid database name' >&2; exit 2; }
[[ "$output" == *.dump.age ]] || { echo 'Output must end in .dump.age' >&2; exit 2; }
[[ ! -e "$output" && ! -L "$output" ]] || { echo 'Refusing to overwrite a backup' >&2; exit 2; }
command -v docker >/dev/null
command -v age >/dev/null
[[ -r "$recipients" ]] || { echo 'Recipients file is unreadable' >&2; exit 2; }
partial=$(mktemp "${output}.partial.XXXXXX")
trap 'rm -f "$partial"' EXIT
# Use the container's configured login; no password/connection URL in process arguments.
docker exec "$source_container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom' sh "$source_database" |
  age --encrypt --recipients-file "$recipients" > "$partial"
[[ -s "$partial" ]] || { echo 'Empty encrypted backup' >&2; exit 1; }
# Atomic, no-clobber publication on the same filesystem, including a concurrent writer.
ln "$partial" "$output"
echo 'Encrypted backup created. Copy off-host, verify checksum, and run a restore drill.'
