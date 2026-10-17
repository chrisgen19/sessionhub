-- Separate database for integration tests, so `pnpm test:db` never touches dev data.
-- Runs only when the volume is first initialized.
CREATE DATABASE sessionhub_test OWNER sessionhub;
