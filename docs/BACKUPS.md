# PostgreSQL backup and restore runbook

Status: procedures and a local encrypted restore drill are implemented. No production database/off-host storage exists yet. A local drill or CI success does not satisfy the real off-host M6 gate.

## Policy to configure before launch

Initial operational targets: daily encrypted backups, 30 daily copies, 12 monthly copies, maximum 24 hours of data loss (RPO), restore within four hours (RTO). These are deployment targets, not a measured guarantee. Review storage costs and publish the actual deletion/backup retention in `/privacy` before registration opens. Alert on backup/upload failure or newest verified copy older than 26 hours. Run a restore drill monthly and after schema/backup-tool changes.

Keep backups in a separate provider/account outside the Coolify host, with restricted credentials and versioning/retention protection. The production machine needs only upload rights and the age **public recipient**. Keep decryption identities in an offline password manager plus an independent recovery copy; never in Git, container images, CI artifacts or the backup bucket. Test recovery with the recovery identity. Record provider, bucket, region, responsible person and key recovery location in the private operator runbook. Do not record secret values here.

Back up runtime secrets separately: `BETTER_AUTH_SECRET`, database credentials and mail credentials/configuration, exact commit/image digests, PostgreSQL version, proxy settings and migration history. A single-database `pg_dump` does not preserve PostgreSQL roles, host firewall, TLS or Coolify configuration. Provision the target login independently. JSON session exports protect local-only sessions; server backups do not include them or recovery checkpoints.

## Create and transfer

Prerequisites on the trusted operator host: Docker access, Bash and [age](https://github.com/FiloSottile/age). Use the PostgreSQL client inside the source container (same major version as the server). Only restore trusted archives: PostgreSQL archives can execute SQL chosen by the source owner.

Create an age identity on an offline recovery machine with `age-keygen -o recovery-key.txt`; derive the public recipients file with `age-keygen -y recovery-key.txt > recipients.txt`. Copy only `recipients.txt` to the backup host. Give private key files mode 0600. Never print or paste the private identity.

```sh
# From this repository, with the actual source container name and an existing private directory:
bash infra/scripts/backup-postgres.sh <postgres-container> sessionhub /secure/recipients.txt /secure/backups/sessionhub-YYYYMMDDTHHMMSSZ.dump.age
sha256sum /secure/backups/sessionhub-YYYYMMDDTHHMMSSZ.dump.age > /secure/backups/sessionhub-YYYYMMDDTHHMMSSZ.dump.age.sha256
```

The script streams a consistent custom-format dump directly through authenticated age encryption, uses a private temporary file, refuses overwrites and publishes only if both commands succeed. A failure removes the incomplete ciphertext. It makes **no plaintext dump file**. Schedule it through a restricted operator job; do not log commands with credentials or pipe decoded SQL to logs.

Upload the encrypted archive and checksum to the configured off-host destination using that provider's CLI and restricted upload credentials. Download the object on an independent machine and run `sha256sum -c` (macOS: `shasum -a 256`). Record the remote object/version id and checksum. Do not prune the last verified usable backup. Apply retention remotely after confirming a replacement uploaded and restored successfully. A successful local dump alone is not a successful backup.

## Isolated drill

Download the off-host archive; verify its checksum. On a trusted recovery machine:

```sh
bash infra/scripts/restore-drill.sh /secure/download/sessionhub-YYYYMMDDTHHMMSSZ.dump.age /secure/recovery-key.txt
```

The script creates its own disposable PostgreSQL 18 container with no network or published ports and ephemeral storage. It decrypts into `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`, verifies completed migrations and validated constraints, and checks that key domain tables exist. It always removes its own target after success/failure. It has no argument for a production target and never connects to one. The key and decrypted data stay on the trusted recovery machine. Do not run with shell tracing.

For a small quiescent fixture, `infra/scripts/database-fingerprint.sql` computes row counts/content hashes for **every public table**, including auth, windows/tabs/groups, versions, clocks, changes, receipts and migrations. Set `DRILL_EXPECT_FINGERPRINT=/secure/expected` to require an exact match. It sorts hashes, not row order. The aggregate is intended for small drill fixtures; for a large deployment use streaming per-table verification and known synthetic canaries from the backup snapshot. A fingerprint computed later against a changing live database cannot be compared to an earlier backup.

Automated local/CI test (only a migrated, populated, idle test database):

```sh
bash infra/scripts/test-backup.sh <test-postgres-container> sessionhub_test
```

This creates temporary keys, backs up, restores, compares all table counts/hashes and tests overwrite rejection, corrupt ciphertext rejection and dump failure without publishing an archive. Test identities and archives are removed. CI runs it after database tests and before browser tests so the source is quiescent.

The automated drill proves database recovery, not a full application restore. Before launch, also restore a downloaded off-host copy into an isolated staging stack, apply only intended forward migrations, start the matching web image and test sign-in, ownership isolation, one saved session export and sync with a **dedicated staging account/profile**. Do not allow a staging copy to send mail to real users or let production extensions contact it.

## Actual disaster recovery

1. Stop writes at the proxy and stop the web service. Preserve the failing database/volume and incident evidence; never restore over it.
2. Select a known usable off-host copy, verify checksum and age authentication, provision a new private PostgreSQL target, and restore using the same tested options. Re-create role grants separately. Restore runtime secrets through the secret manager.
3. Start the matching application version in isolation. Verify migrations, user/session counts and synthetic canaries, ownership checks, credentials and expected sync behavior. Measure restore time and missing writes against RTO/RPO.
4. A database rollback rewinds sync clocks and receipts while browsers may hold newer cursors/edits. **Do not reopen production sync immediately.** Retain local copies/exports, invalidate restored web sessions and device credentials as appropriate, and require a reviewed re-pair/rebootstrap plan. Do not delete outboxes or automatically accept stale uploads. If recovery cannot preserve newer client work, keep writes offline until a recovery procedure is tested.
5. Switch the private database connection only after validation; resume writes gradually and monitor failures. Retain the original volume until recovery is signed off.

## Evidence required for M6

Record date, exact app commit/image, PostgreSQL version, encrypted object's off-host version/checksum, decryption with the recovery key, migrated-table/invariant checks, staging app tests, measured RPO/RTO and operator result in PROGRESS (no secrets or user data). No real off-host restore or RPO/RTO claim has been verified yet.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [age usage](https://github.com/FiloSottile/age).
