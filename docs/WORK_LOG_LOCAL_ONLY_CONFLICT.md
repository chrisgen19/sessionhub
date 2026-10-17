# Keep-in-this-browser conflict identity fix

Branch: `bugfix/local-only-conflict-identity`; based on main `8c4102e`.

## Acceptance and plan (2026-10-17)

Source: issue #5 Smaller leftovers; PRD Journey C (preserve conflicting work), local-first/account-isolation invariants and SYNC_PROTOCOL 13i. The user authorized implementation after reviewing the priority and creating the worktree.

1. Add regressions for resolving a rejected synced edit with no held server copy: keep the local work under a new identity, restore the account's unchanged version even when its pull cursor has passed it, and never queue the local copy for upload.
2. Give every local-only resolution a fresh session/window/group/tab identity. Preserve a held account copy under the original id; otherwise durably request bootstrap only when an account session may already exist. Preserve sync consent, unrelated pending work, account isolation and transaction rollback. Test interrupted/in-flight download behavior where relevant.
3. Run extension/sync lint, typecheck and tests, extension production build and relevant real-browser checks; record exact results and update protocol/data/UX/release/progress docs.

No production service or personal browser data is used. No M5/workspace changes, LIMIT_REACHED retry feature or revoked-session redirect fix are included.

## Outcome

Implemented the fresh local identity and atomic cursor/bootstrap reset, preserving any held account copy, consent, backoff and unrelated work. Eight new regression tests cover recovery, missing/held/deleted server state, disabled sync, account isolation, unrelated queued work, transaction rollback and an in-flight old pull. A real-browser regression exercises the actual >1.5 MB client rejection, UI choice, canonical download and independent local draft.

Validated: initial regression run 6 failed / 2 passed before the fix; focused repository/downloader suites 35/35 after the fix; `pnpm check --force` 17/17 tasks and 416 unit tests; `pnpm build` both apps; focused new browser test 1/1; full web E2E 48/48; extension E2E 9/9; `git diff --check`. Exact commands and verification caveats are in PROGRESS.

No schema migration, server behavior or personal data changed. Already-resolved old local-id collisions are not bulk-migrated. LIMIT_REACHED retry and revoked web-session redirects remain pending. No push or PR is included in this implementation task.

## PR #17 and main integration

On the user's subsequent PR request, pushed `1a3487f` and opened #17. Main had advanced through #15 (`3b8a37a`); integrated it with only a PROGRESS documentation conflict, preserving both histories. Combined-branch checks: `pnpm check --force --concurrency=1` 17/17 and 419 unit tests; web DB suite 66/66; both builds; root `pnpm test:e2e` extension 9/9 + web 49/49. Git diff checks pass; CI on the pushed resolution remains to be observed. No extra behavior or migration was introduced during integration.
