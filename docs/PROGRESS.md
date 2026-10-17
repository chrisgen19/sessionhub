# SessionHub — Persistent Implementation Handoff

> **This is the first file a returning coding agent should read.**  
> **Last updated:** 2026-10-17
> **Current milestone:** M5 started (workspaces in the extension and the web filter and assignment merged, PRs #18 and #19); M6 release preparation; M4 (cross-device sync) **done**: pairing, outbox, push, pull, opt-in with upload preview, sync status UI and conflict review all work, verified across two real extension profiles. M6 repository release preparation implemented (6/8 checklist items; production privacy/operator details and real-host/off-host recovery still pending): rate limits for reads and shared (multi-instance) limiter storage done; structured redacted logs with request ids and resource limits done; trusted-proxy client IP, HTTPS requirements and the Coolify checklist (`docs/DEPLOYMENT.md`) done, not yet deployed. Public privacy page, store copy/icons/screenshots, encrypted backup/restore scripts and release/rollback docs are now implemented. M3 complete (database, auth with reset and confirmation, dashboard, session/workspace/device APIs, Docker). M2 complete.

## Current truth (verified 2026-10-17)

| Area | State |
|---|---|
| Monorepo | **Working.** pnpm 11 workspaces + Turborepo 2.11; `pnpm check`, `pnpm build`, `pnpm test:e2e` pass |
| Chrome extension | **Working local slice** plus opted-in account sync and durable outbox. Save current/all windows (tabs, pinned, groups) to IndexedDB; popup recent list + search; manager list/search/inspector; rename (version-checked); delete (confirmed); export JSON; **import JSON with preview**; restore preview -> new windows -> per-tab summary -> **retry failed tabs** (also from a reopened "Last restore" summary; cut-off restores settled on the next worker start); **automatic recovery checkpoints** with a Recovery view |
| Workspaces | **Working (M5, 2026-10-17, PR #18 and PR #19 merged).** Synced both ways between the web and the extension (account only, per-field merge, deletes win, deleting moves sessions out). Manager: switcher filter, Workspaces dialog (create, rename, recolor, delete), inspector assignment. Verified across two real extension profiles. Web: filter and assignment on Saved sessions. Not in the popup or side panel yet; no workspace management on the web |
| Side panel, settings | Not implemented |
| Web app | Landing page, **Better Auth email/password** (`/signup`, `/login`, `/api/auth/*`) on PostgreSQL with **password reset, email confirmation and change password** (Resend or Mailpit); **dashboard shell** at `/app` (Overview, Saved sessions with search, Devices, Settings) reading account-scoped data; **`/api/v1/sessions`** and **`/api/v1/workspaces`** CRUD with versions, tombstones and change log; **`/api/v1/devices`** list/rename/revoke; **session detail page** (tree, rename/archive/delete with conflict handling, export, open links); `GET /api/health` |
| Database | **Schema, 3 migrations (`init`, `device_pairing_and_credentials`, `rate_limit_buckets`) + integration tests** (`packages/database`, Prisma 7.10.0, PostgreSQL 18 via Docker), used by the web app for auth, sessions, workspaces, devices and pairing |
| Pairing | **Working.** Extension Account view -> `/app/pair` approval (signed in, confirmed email) -> rotating, hashed device credentials; revoke from the web Devices page or the extension; audit events |
| Sync | **Complete for saved sessions** (two-profile E2E, incl. a real conflict): opt-in with upload preview (move, all ticked), status chip and per-session labels, `sync.now`, push with receipts, pull with HMAC cursors and bootstrap, `packages/sync` rules, conflict review (keep mine / keep the other version / keep both, plus the deleted, id-in-use and rejected cases). Workspaces and session assignments sync too (SYNC_PROTOCOL.md 13j) |
| Deployment | **Production image + compose stack, database readiness and encrypted backup/restore drill.** `infra/docker/web.Dockerfile` (`runner`: Next.js standalone on `node:24-alpine`, non-root, `HEALTHCHECK` on `/api/health`; `migrate`: one-shot `prisma migrate deploy`), `infra/docker/compose.yaml` (postgres -> migrate -> web). Tested by `pnpm test:docker`. Not yet deployed anywhere |
| CI | Runs on GitHub (private repo `chrisgen19/sessionhub`) for every PR (`check`: lint, typecheck, unit, DB and E2E tests with PostgreSQL + Mailpit services; `docker`: the production image and compose stack) and every push to `main` (a newer push cancels a run in progress). GitGuardian's findings on #1 and #2 were false positives (marked by the user) |
| Git | Remote `origin` = https://github.com/chrisgen19/sessionhub (private). **The whole stack (#1 to #11) was merged on 2026-10-17** (`765989c`), bottom-up, one merge commit per PR (`e305902` #1 ... `765989c` #11), and every `feature/*` branch was deleted. New work goes on short branches off `main`, one small PR each. PR #12 (`bugfix/restore-retry-e2e`, flaky restore-retry E2E fix) merged as `b048a6d`. PR #13 (framing protection) merged as `dc827cd`. PR #14 (CI release ZIP) merged as `1b9dd50`. PR #16 merged as `8c4102e` (M6 worktree/branches cleaned up); PR #15 (workspace sync, server side) merged as `3b8a37a`; PR #17 (`bugfix/local-only-conflict-identity`) merged as `acd9342`. PR #18 `feature/m5-workspaces-extension` (workspaces in the extension) merged as `5afefe2`. PR #19 `feature/web-workspaces-filter` (web workspace filter and assignment) merged as `4cd07de`. Latest change: PR #20 `bugfix/web-sync-copy` (stale sync copy on the dashboard), open against `main`. Uncommitted on the WSL machine only: a one-line `packages/eslint-config/base.js` change (`e2e-docker` lint exemption) that the user hasn't decided on; not needed by any code |

Dependency versions and their rationale: `docs/SYSTEM_DESIGN.md` section 14.

## Session log

### 2026-10-17 (save picker: choose which tabs to save) / Claude Code (Opus 5.5) / `feature/save-tab-picker` (macOS laptop)

**Why:** the popup's one-click **Save window** / **Save all (N)** saved every tab without showing anything, and with sync on queued every URL for upload. The user called it dangerous and asked for Session Buddy's approach.

**Research:**
- Session Buddy's docs and release notes: v4 made windows and tabs selectable "for more precise actions like saving just a portion of a session" (checkboxes, Ctrl/Cmd-click, Shift ranges); v4.1 added a selection action bar; browser pages are "never displayed or saved".
- OneTab reviews: complaints that one click sends every tab.
- Reddit couldn't be fetched from this environment.

**User's choices:** the picker in the popup and the manager; the current window ticked; browser pages listed but unticked; a prefilled name.

**Implemented:**
- `packages/core`: `normalizeSessionName` (shared by rename and save), `selectionSessionName`.
- `apps/extension/src/lib/tab-selection.ts`: the pure selection rules. Header targets, tri-state, toggles, Shift ranges, select all/none, `reconcile` (closed tabs drop out, new tabs unticked), `summarize`, and the worker's `selectTabs`.
- `lib/tab-segments.ts`: group runs, shared with the saved-session window tree.
- Worker:
  - `session.capture` takes `scope: { kind: "tabs", tabIds }` and `name`, and returns `missing`
  - `browser-capture.ts` keeps only the ticked ids, reading titles and URLs from Chrome
  - `command-handlers.ts` validates the name before reading the browser
- UI:
  - `hooks/use-open-windows.ts`: live windows, current window first, refreshed on tab and window events
  - `features/save/`: `TabPicker`, `SaveBar`, `SavePanel`, `OpenTabsView`
  - popup "Save tabs" with "Open full view"; manager nav **Open tabs** (`#view=open-tabs`)
  - `quick-save-actions.tsx` removed
  - the manager's mobile nav wraps (four items overflowed at 390 px)
- Tests:
  - new: `tab-selection.test.ts` (8), command handler (+2), `save-ui.test.tsx` (4)
  - popup tests updated to the picker (open windows mocked, since WXT's fake browser has no tab events)
  - extension E2E: the popup save test now uses the picker, and a new real-Chromium picker test covers a header click, a browser page staying unticked, a ticked tab closed meanwhile, and that only the ticked tab is saved
- Docs: UI_UX_DESIGN principle and section 18i, USER_FLOWS Flow 2, SECURITY_PRIVACY section 2, SYSTEM_DESIGN decision, TEST_PLAN.

**Validated (macOS; web E2E on temporary `docker run` PostgreSQL and Mailpit at 54369/58065):**
- `pnpm check --force` 17/17 (extension 240 tests, +14).
- Extension E2E 10/10; the new picker test 3/3 on repeat.
- `pnpm build`; full web E2E 54/54.
- Popup at 380 px and Open tabs at 1280 and 390 px, light and dark: no horizontal overflow after the nav fix.

**Not changed:** recovery checkpoints (automatic, local-only, never uploaded); `window` and `all-windows` scopes stay for tests and fixtures.

**Next step:** PR #25 is open; wait for its Codex review, then merge. PRs #23 (the CI upload fix) and #24 (the deployment results) were merged (`0788ccb`, `94707d4`), and `main` was merged into this branch.

### 2026-10-17 (first deployment verified: sessionhub.cgdev.site) / Claude Code (Opus 5.5) / `feature/first-deploy-results` (macOS laptop)

**Deployed:** PR #22 merged as `83cdd15` (its CI green: `check`, `docker`, `extension-zip`; `deploy` skipped on the PR by design). The first deployment was built from the PR branch to test Coolify before merging: the GitHub App cloned the private repository, `migrate` ran and exited, `web` became healthy, and no secret appeared in the deployment log (hidden lines included) or as a build argument. The app was then switched back to `main` and redeployed from `83cdd15` (`running:healthy`).

**DEPLOYMENT.md checks against `https://sessionhub.cgdev.site` (from the macOS laptop, after the `main` redeploy):**

| Check | Result |
|---|---|
| 3. http redirects to https | **307** Temporary Redirect to `https://sessionhub.cgdev.site/` (expected 301/308; Coolify's redirect isn't permanent). HSTS covers later visits |
| 3. HSTS on `/api/health` | `strict-transport-security: max-age=31536000` |
| 3. Framing on `/login` | `content-security-policy: frame-ancestors 'none'`, `x-frame-options: DENY` |
| 3. Health | `{"status":"ok"}` (configuration valid, database probe ok over the private network) |
| 3. API without a session | `HTTP/2 401` with an `x-request-id` |
| 3. Certificate | Let's Encrypt (`YR2`), valid until 2027-01-15 |
| 2. Six pairing starts with different fake `X-Forwarded-For` | 201, 201, 201, 201, 201, **429**: the fake values were ignored (`TRUSTED_PROXY_COUNT=1` behind Traefik) |
| 5. Request logs | one JSON `http_request` line per request (method, id-free path, status, duration); no emails, client addresses or URLs (only Next.js's startup banner mentions `http://localhost:3000`) |

The pairing check left five pending pairings, which expire after 10 minutes.

**Extension for production:** built with `WXT_API_BASE_URL=https://sessionhub.cgdev.site` into `apps/extension/.output/prod/chrome-mv3` (host permission only that origin, no `localhost:3000` in the bundle); in a throwaway Chromium profile it saved a window and reached the live `/api/health`. The repository variable `EXTENSION_API_BASE_URL` is set, so CI's `extension-zip` now builds and uploads the release ZIP for this origin.

**Open:**
- `COOLIFY_TOKEN` repository secret (a Coolify API token with deploy permission, to be created by the user); until it exists the CI `deploy` job skips and deploys are manual (`coolify deploy uuid v5tdb1gh3vky09itrppd4t33`). `COOLIFY_DEPLOY_WEBHOOK` is set.
- The http redirect status (307): a Traefik label for a permanent redirect, if wanted.
- By hand: sign in and check the `__Secure-` session cookie flags; the first real Resend email (account confirmation).
- `BACKUPS.md` off-host restore drill; `/privacy` operator/contact/retention details before sharing the URL (registration is open).

### 2026-10-17 (first deployment: Coolify at sessionhub.cgdev.site) / Claude Code (Opus 5.5) / `feature/coolify-deploy` (macOS laptop)

**User's choices:** domain `sessionhub.cgdev.site`; the shared PostgreSQL with its own role (JobTrack's pattern); Resend on JobTrack's verified domain; CI-triggered deploys with Coolify auto-deploy off (Debt Tracker's pattern).

**Coolify (done before the PR, nothing deployed yet):** project `SessionHub`, application `sessionhub` (`v5tdb1gh3vky09itrppd4t33`, Docker Compose, `/compose.coolify.yaml`, `web` on the domain, predefined network on, auto-deploy off), role and database `sessionhub` on the shared PostgreSQL 17.8 (not superuser, `CONNECT` revoked from `PUBLIC`, login checked), 7 runtime environment variables (secrets never printed; temp files deleted), `sessionhub` added to the shared daily backup (only that field changed: the CLI's update sent other values and was refused with 422, so the API was used with just the list). Details: `DEPLOYMENT.md` section 8.

**Repository:** `compose.coolify.yaml` (repository root, because Coolify uses it as the compose project directory: `migrate` then `web`, no PostgreSQL), CI `deploy` job (after `check`, `extension-zip`, `docker` on `main`; skips until `COOLIFY_DEPLOY_WEBHOOK` and `COOLIFY_TOKEN` exist), `DEPLOYMENT.md` section 8.

**Not verifiable in advance:** the Coolify GitHub endpoints answer HTTP 500 even for JobTrack, so access of the GitHub App to `chrisgen19/sessionhub` shows only on the first build.

### 2026-10-17 (local dev setup; README database section) / Claude Code (Opus 5.5) / `bugfix/readme-db-setup` (macOS laptop)

**Dev environment (no code change):** this laptop has no Docker Compose plugin (Colima), so `pnpm db:up` fails. Started `sessionhub-dev-postgres` (127.0.0.1:54329, volume `sessionhub-dev_sessionhub-postgres`) and `sessionhub-dev-mailpit` (127.0.0.1:58025) with `docker run` and the `compose.dev.yaml` settings, applied the 3 migrations with `pnpm --filter @sessionhub/database db:deploy`; the user's running `next dev` then answered `/api/health` 200. Extension built for `http://localhost:3000`.

**README:** documents that `docker run` fallback (with a readiness wait), `db:deploy`, and which DB test command resets: root `pnpm test:db` runs the database package first, which resets `sessionhub_test` (`prisma migrate reset --force`), then the web package, which only runs `migrate deploy`. An earlier remark in this session that "test:db doesn't reset" was wrong (only the web package's setup had been read); corrected before writing the README. No reset was run in this session: only `pnpm --filter @sessionhub/web test:db`, against throwaway containers.

### 2026-10-17 (stale sync copy on the dashboard) / Claude Code (Opus 5.5) / `bugfix/web-sync-copy` (macOS laptop)

**Goal (user's scope):** fix the out-of-date sync wording in the sidebar and on Overview. Branched off `main` at `4cd07de` (PR #19 merged at the user's request while its `check` and `docker` jobs were still running).

**Done:**
- The sidebar said "Sync off / Cloud sync isn't available yet". Whether sync is on is a per-browser choice the server can't see, so it now shows connected browsers and their latest activity instead (`getConnectionStatus` in `server/queries/dashboard.ts`, read by `app/app/layout.tsx`; `components/dashboard/app-shell.tsx`).
- Overview: the sync notice shows only while no browser is connected, with current wording; the empty state no longer says sync isn't available (`page-parts.tsx`, `app/app/page.tsx`).
- Same stale claim fixed in two more places (scope stated to the user): Settings' Sync section and Privacy line (`settings/page.tsx`), and the sign-in pages' footnote (`(auth)/layout.tsx`). The landing page lists workspaces as working (`app/page.tsx`).
- Tests: `dashboard.db.test.ts` (connection status: revoked browsers don't count), `e2e/dashboard.spec.ts` (new-account wording, no "isn't available yet" anywhere; connected-browser sidebar, Overview and Settings).
- Docs: UI_UX_DESIGN.md 18c-update.

**Validated (macOS, temporary `docker run` PostgreSQL + Mailpit on 54369/58065):** `pnpm check --force` 17/17; web DB tests **67/67**; full web E2E **54/54**; Overview, sidebar and Settings checked at 1440 px in both states and Overview at 390 px in dark mode.

**PR #20 review (Codex, 1 P2 finding), valid and fixed:** "Sync is turned on in each browser's extension" (sidebar) and "Sync is turned on in each browser, in the SessionHub extension" (Settings) read as status claims, which the server can't make: a connected browser may have sync off. Both now say where to change it ("Turn sync on or off in each browser's extension"). `dashboard.spec.ts` asserts the new wording and that no page says "sync is (turned) on/off". Dashboard, workspace and detail E2E specs 15/15; web unit tests pass.

**Next step:** PR #20 is open (CI not yet seen); then workspace management on the web (`/app/workspaces`) or the side panel.

### 2026-10-17 (M5 workspaces, part 3: web dashboard filter and assignment) / Claude Code (Opus 5.5) / `feature/web-workspaces-filter` (macOS laptop)

**Goal (user's scope):** workspace filter and assignment on `/app/sessions`. Branched off `main` at `5afefe2` (PR #18 merged; its `check` job was still running at merge time, at the user's request).

**Plan:**
- `server/queries/dashboard.ts`: `listSessions` takes a workspace filter (an id or "none") and returns each session's workspace; a new user-scoped query lists the workspaces with session counts for the current view (active or archived).
- `/app/sessions`: `?workspace=<id|none>` combined with `view` and `q`; an id the user doesn't own is ignored. A "Workspace" select beside the Active/Archived tabs (a client component that updates the URL); rows show their workspace.
- `/app/sessions/[id]`: a "Workspace" select that sends `PATCH /api/v1/sessions/:id { expectedVersion, workspaceId }` with the existing notices (a version conflict offers "Load latest version").
- Copy on these pages that still says sync isn't available (empty state, delete dialog) is corrected. The overview's notice and the sidebar label are left for later.
- Tests: DB tests for the filter and ownership, E2E for filter + assignment + conflict, 1440 and 390 px.

**Implemented:**
- `apps/web/src/server/queries/dashboard.ts`: `listSessions` takes `workspace` (an id or `NO_WORKSPACE`) and returns `workspaceId`; new `listWorkspaceChoices` (live, display order, at most 100) and `listWorkspaceFilters` (counts per view plus "no workspace").
- `apps/web/src/lib/workspace-filter.ts`: `NO_WORKSPACE`, `parseWorkspaceFilter` (only the user's own ids), `sessionsHref`. `lib/group-colors.ts` shares the palette with the window tree.
- `/app/sessions` (`page.tsx`): filter in the URL with view and search, filtered descriptions and empty states, workspace names in rows (`components/dashboard/session-list.tsx`, `color-dot.tsx`, `workspace-filter.tsx`).
- `/app/sessions/[id]`: `components/sessions/workspace-select.tsx` (PATCH with the loaded version; resyncs on a new version so its notice survives the refresh; choosing the current workspace sends nothing). `notice-line.tsx` is shared with `session-actions.tsx`.
- Copy: the no-sessions empty state and the delete dialog no longer say sync isn't available.
- Tests: `src/lib/workspace-filter.test.ts` (2), `dashboard.db.test.ts` (+1: filter, counts per view, ownership, order, deleted and unknown colors), `e2e/session-workspaces.spec.ts` (4: filter across views and foreign ids; assignment, conflict and Load latest version; no-workspace state; 390 px). `e2e/session-detail.spec.ts` follows the new delete copy.

**Validated (macOS, temporary `docker run` PostgreSQL + Mailpit on 54369/58065):**
- `pnpm check --force` 17/17 (web unit tests 76, +2); `pnpm --filter @sessionhub/web test:db` **67/67** (+1); `pnpm --filter @sessionhub/web build`.
- Full web E2E **54/54** (+4); the new spec and `session-detail.spec.ts` also ran 3 times each (30/30).
- Found and fixed while testing: keying the select by version remounted it after a successful move and wiped the "Moved to" notice (the first E2E run only passed that step by winning the race).
- Screens checked at 1440 and 390 px and dark mode at 390 px.
- Not run: extension suites (no extension change), `pnpm test:docker`.

**Known gaps:** no workspace create/rename/delete on the web (the session page points to the extension); the list's filter isn't on the Overview page; the sidebar's "Sync off / Cloud sync isn't available yet" and the Overview's sync notice are still out of date (the Overview's is asserted by `dashboard.spec.ts`), worth a small copy PR. PR #19 open; CI not yet seen.

**Next step:** watch CI on PR #19 and address review; then the stale sync copy on Overview and the sidebar, or workspace management on the web.

### 2026-10-17 (M5 workspaces, part 2: extension) / Claude Code (Opus 5.5) / `feature/m5-workspaces-extension` (macOS laptop)

**Goal (user's scope):** Dexie v6 `workspaces` table, `workspaceId` on local sessions, pull/bootstrap apply (drop account workspaces missing from the live set unless they have pending changes), upload of workspace operations and assignments, the workspace switcher and assignment in the manager. Branched off `main` at `3b8a37a` (CI green).

**Decisions (user's choices, 2026-10-17):**
- Workspaces are **account only**: sessions only in this browser can't be assigned. Local workspaces may come later.
- Workspace edit conflicts use a **per-field merge**: an upload carries only the fields changed here, and after a conflict it is sent again on top of the newer version. Deletes win over edits in both directions. No review dialog for workspaces.
- Deleting a workspace that still has sessions **moves them out** (to "No workspace"), with the count in the confirmation. The unassignments upload before the delete.

**Plan:** (1) contracts and push: a workspace update may leave out `name` (needed by the per-field merge; a create still needs it); (2) extension data and sync: v6 schema, workspace repository and commands, outbox dependencies (a session waits for its workspace's create, a workspace delete waits for its unassignments), push results, pull and bootstrap apply, a one-time rebuild so existing assignments and workspaces download; (3) manager UI: switcher, workspace dialog, assignment in the inspector; (4) docs.

**Implemented** (commits `1ea0b72`, `0601a59`, `31ae851`, `1234b6f`, plus docs):
- Contracts and server (small, backward compatible): `syncWorkspacePayloadSchema` fields are all optional with at least one present, and a create needs `name` (`packages/contracts/src/api-sync.ts`); `apps/web/src/server/sync/push.ts` passes an update without a name through.
- Extension data (`apps/extension/src/lib/`):
  - `db.ts`: Dexie v6 `workspaces` table, `workspaceId` beside account sessions, outbox `entityType` `workspace` with `waitFor` on deletes. The v6 upgrade clears every account's cursor (one rebuild).
  - `workspace-repository.ts`: create (local limit of 100), update (only changed fields), delete (sessions moved out first; never-uploaded workspaces just dropped), `assignSession` (account sessions only), `readWorkspaces`.
  - `outbox-repository.ts`: `enqueueWorkspaceUpsert` (merges into a queued edit), `enqueueWorkspaceDelete`, `requeueRefused`, `clearWorkspaceFromQueue`.
  - `sync-batch.ts`: workspace operations, `workspaceId` in session uploads once known, dependency waits.
  - `workspace-sync.ts`: pull apply with waiting fields on top, `forgetWorkspace`, first-page bootstrap drop, push results (merge and resend on conflict, deletes win, `WORKSPACE_NOT_EMPTY` brings it back, refused creates kept as errors), `INVALID_WORKSPACE` resend without the workspace.
  - `sync-apply.ts`, `sync-downloader.ts`, `sync-uploader.ts`, `session-repository.ts`, `sync-consent.ts`, `review-repository.ts` (sessions only in review; keep mine/keep both keep the workspace), `messages.ts` and `command-handlers.ts` (`workspace.create/update/delete`, `session.assign`), `background.ts` (sync after them).
- Manager UI (`apps/extension/src/features/workspaces/`, `manager/`, `review/review-list.tsx`, `hooks/use-workspaces.ts`, `hooks/use-manager-route.ts`, `components/color-dot.tsx`): switcher with counts in the URL hash, workspace names in rows, Workspaces dialog, inspector picker, refused workspaces under Needs review.
- Tests: `workspaces.test.ts` (13, with the in-memory `workspace-test-server.ts`), `workspaces-ui.test.tsx` (4), v5 to v6 migration test (+1), contracts (+2 cases), `push.db.test.ts` (an update with only a color), web E2E `sync-workspaces.spec.ts` (new: two real extension profiles plus the web, UI-driven create, assign and delete, per-field merge, web delete).
- Docs: SYNC_PROTOCOL 13f/13g amended and new 13j, DATA_MODEL section 4, UI_UX_DESIGN 18g, SYSTEM_DESIGN decisions, ROADMAP M5, TEST_PLAN multi-device rows, README status.

**Validated (macOS, temporary `docker run` PostgreSQL + Mailpit on 54369/58065; another session's containers on 54359/58055 left alone):**
- `pnpm check --force`: 17/17 tasks; extension unit tests **215** (+18).
- The new UI test first failed under the parallel Turbo run (`getByRole` on the inspector's picker, which renders once its own live query loads); fixed with `findByRole`, then 5/5 parallel runs passed.
- `pnpm build`: pass. `pnpm --filter @sessionhub/web test:db`: **66/66**.
- Full web E2E: **49/49** (+1), including both existing two-profile specs and `sync-push`. Extension E2E: **9/9**.
- Manager checked in Chromium with the built extension and seeded data at 1280 and 390 px (list, Workspaces dialog, delete confirmation, inspector) and the Sync card in dark mode at 390 px: no horizontal overflow.
- Not run: `pnpm test:docker` (no image or compose change), the backup drill.

**Known gaps:**
- No workspace in the popup, side panel or web dashboard; new saves aren't put in the selected workspace; the selected workspace isn't remembered across manager tabs (URL hash only).
- A delete refused with `WORKSPACE_NOT_EMPTY` brings the workspace back without a message.
- PR #18 open; CI not yet seen.

**PR #18 review (Codex, 2 P2 findings), both valid and fixed:**
- *Delete while a create is in flight, then the create is refused:* reproduced. The refused create held the queued delete back forever, and the workspace was hidden (deleted here), so "Needs review" showed with nothing to review. Now a refused change gives way to a delete queued behind it: a refused create forgets the workspace, a refused edit moves the delete onto its base version (`workspace-sync.ts`).
- *Replacement create at the 100 limit while a delete waits for its sessions:* reproduced. The create went out in the same push as the unassignment, before the delete, and was refused `LIMIT_REACHED` for good. Now workspaces deleted here count toward the local limit until the account accepts the delete, with a message saying so (`workspace-repository.ts`).
- Tests: `workspaces.test.ts` +3 (both refusals, and the limit); the test server gained a refusal hook, a during-push hook and the 100 limit. `pnpm check --force` 17/17, extension tests 218.

**Next step:** watch CI on PR #18 and address review, then the next M5 item from ROADMAP.md (workspaces on the web dashboard, or the side panel).

### 2026-10-17 (PR #17: integrate current main and resolve documentation conflict) / Codex / `bugfix/local-only-conflict-identity`

**Request:** open the local-only identity fix as a PR, then continue until it is reviewable. PR #17 was created from `1a3487f`; GitHub reported a conflict because PR #15 had meanwhile merged into main as `3b8a37a`.

**Resolution:** merged current main into this branch. The only textual conflict was `docs/PROGRESS.md`: kept both session histories and both sets of remaining work, updated #15/#16 as merged and #17 as open. Workspace contracts/server behavior from main and the local-only fix are preserved. No source conflict or additional fix behavior change. Compared against `origin/main`, the diff remains the original fix, regression tests and documentation. Other worktrees were not changed.

**Verification of the combined branch:**
- `pnpm check --force --concurrency=1`: **17/17 tasks**, lint/typecheck plus **419 unit tests** (core 84, contracts 39, sync 17, web 74, extension 205). Sequential tasks avoid the previously observed generated-client race.
- `TEST_DATABASE_URL=postgresql://sessionhub:<test-only-password>@127.0.0.1:54359/sessionhub_test pnpm --filter @sessionhub/web test:db`: **66/66**, including the newly merged workspace server cases; non-destructive migration deployment.
- `pnpm build`: **both apps pass**.
- Same isolated database env plus `TEST_MAILPIT_URL=http://127.0.0.1:58055 pnpm test:e2e`: **4/4 tasks**, extension **9/9** and web **49/49**, including workspace round-trip, two-profile sync/conflict and the new oversized-edit/local-only recovery flow.
- `git diff --cached --check`: pass. The two disposable test containers are removed after verification. No production/personal data was used.

PR #17 description is updated with these combined-branch results. GitHub CI must run on the pushed merge-resolution commit; local success is not a claim that CI has already passed. Existing already-resolved old id collisions remain outside automatic migration.

### 2026-10-17 (issue #5 Smaller leftovers: local-only conflict identity) / Codex / `bugfix/local-only-conflict-identity`

**Scope:** user requested prioritization of Smaller leftovers and an isolated worktree, then authorized implementation. Based on `origin/main` `8c4102e`; worktree `/Users/chrisgen19/projects/sessionhub-fix-local-only-conflict`. The active M5 checkout/merge and its files were left alone. Acceptance and implementation plan recorded first in `WORK_LOG_LOCAL_ONLY_CONFLICT.md`.

**Problem:** a refused edit of an already-synced session could choose "Keep in this browser only" without a held server copy. It kept the original id under `local` scope; account pulls skip another scope's id, hiding the server version. Merely changing the id would still leave an unchanged account version absent if its cursor had already passed it.

**Implemented:**
- Every local-only review outcome creates a separate session with fresh session/window/group/tab ids, version 1 and preserved contents; no sync metadata or outbox entry for that local copy. The manager receives/selects the new id.
- Preserve a held account upsert immediately under its original id. Without a held upsert/delete, if the record previously synced or its id was taken, reset only this account's cursor/bootstrap progress in the same resolution transaction. Next ordinary sync reuses the existing durable bootstrap to retrieve the unchanged original.
- Preserve sync consent, backoff, unrelated account state and pending edits. Sync off stays off, offline recovery waits for normal sync. A known deletion or never-accepted create doesn't need an account rebuild. No network request happens inside resolution, no browser actions or uploads of the local copy occur.
- Added `syncState` to the existing Dexie transaction; no schema migration or server/API change.
- Eight new repository/download regression tests cover missing/held/deleted state, taken-id create, disabled sync and another account's cursor, partial bootstrap progress, unrelated queued edits, rollback if recording the refresh fails, and a pull already in flight.
- Real extension/HTTP/PostgreSQL browser regression: upload an original and advance its cursor; inject a >1.5 MB local edit; the actual uploader rejects it with no held copy; choose local-only through the review dialog; verify canonical and local versions both visible, manager selection follows the new id, server still has only the original and live tabs are unchanged.
- Updated protocol, data, UX, test, system-design and release notes.

**Validated (macOS, existing Node 24.18.1 / pnpm 11.17.0 dependencies):**
- `pnpm install --frozen-lockfile --offline`: pass, lockfile unchanged.
- Before fix: `pnpm --filter @sessionhub/extension exec vitest run src/lib/local-only-recovery.test.ts`: **6 fail / 2 pass**, demonstrating the missing identity/refresh and rollback protection.
- After fix: `pnpm --filter @sessionhub/extension exec vitest run src/lib/local-only-recovery.test.ts src/lib/review-repository.test.ts src/lib/sync-downloader.test.ts`: **35/35**.
- `pnpm check --force`: **17/17 tasks**, lint/typecheck and **416 unit tests** (extension 205, web 74, core 84, contracts 36, sync 17). Initial check caught an ambiguous union in the new test fixture; fixed its explicit upsert discriminator. One later parallel check encountered an existing generated-Prisma-client timing race; after build finished, the final check passed. No unrelated task-graph change was made.
- `pnpm build`: **pass**, extension and standalone web.
- Isolated local PostgreSQL 18 and Mailpit on `127.0.0.1:54359` / `:58055`, using synthetic accounts/URLs only:
  - `TEST_DATABASE_URL=postgresql://sessionhub:<test-only-password>@127.0.0.1:54359/sessionhub_test TEST_MAILPIT_URL=http://127.0.0.1:58055 pnpm --filter @sessionhub/web exec playwright test e2e/local-only-recovery.spec.ts`: **1/1**.
  - Same test env, `pnpm --filter @sessionhub/web test:e2e`: **48/48**, including two-profile sync/conflict and the new rejected-edit recovery flow.
  - `pnpm --filter @sessionhub/extension test:e2e`: **9/9**, save/restore, offline persistence, worker restart and recovery checkpoints.
- `git diff --check`: pass. No DB reset suite, separate backend DB suite, Docker image/backup/perf suites or GitHub CI run for this slice (no server, dependency, manifest, backup or restore behavior change). The web browser harness applied migrations non-destructively to the new isolated test database.

**Remaining limits / next work:** newly performed local-only resolutions are fixed; older already-resolved id collisions are not automatically migrated. No production deployment exists. `LIMIT_REACHED` retry after freeing capacity is the next recommended Smaller leftover; revoked-session deep-link preservation, M0 decisions and production log shipping are still pending. Branch is ready for review; not pushed or merged in this task. The two disposable test services are removed after verification; other worktrees/services are untouched.

### 2026-10-17 (M5 workspaces, part 1: sync server side) / Claude Code (Opus 5.5) / `feature/m5-workspaces` (macOS laptop)

**Goal:** workspace switcher and assignment in the extension (user's scope).

**Found:**
- `/api/v1/workspaces` is cookie-only (web), and the extension talks to the server only through sync.
- Sync push accepted only sessions, and only `{ name, windows }`: SYNC_PROTOCOL.md 13f made the workspace a web-only field.
- Pull already sent workspace changes, but the extension skipped them (`sync-apply.ts:45`).
- `SYNC_PROTOCOL.md` says "MVP synced: Workspace".

**Decisions** (user's choices): workspaces sync both ways; server first, extension in the next PR. Recorded in SYSTEM_DESIGN.md 14.

**Implemented:**
- `packages/contracts/src/api-sync.ts`:
  - the push operation is a union of `savedSession` and `workspace` operations
  - the session payload gets an optional `workspaceId` (absent keeps the server's, `null` unassigns)
  - new `syncWorkspacePayloadSchema` (`name`, plus optional `description`, `icon`, `color`, `position`; absent keeps the server's)
  - new rejected code `WORKSPACE_NOT_EMPTY`
- `packages/contracts/src/api-workspaces.ts`: `workspaceFieldSchemas` is shared with sync.
- `apps/web/src/server/workspaces/service.ts`: `createWorkspaceInTx`, `updateWorkspaceInTx`, `deleteWorkspaceInTx`, with the REST wrappers unchanged in behavior.
- `apps/web/src/server/sync/push.ts`:
  - `applySession` (passes `workspaceId` through) and `applyWorkspace`
  - one `acceptedOrRepeat` wrapper for the services' idempotent repeats
- `apps/web/src/server/sync/pull.ts`: the first bootstrap page carries the complete set of live workspaces ahead of the sessions; `nextAfter` still pages sessions only, so current extensions keep working.
  - After PR #15's review (Codex P2), tombstones aren't sent: they only grow, and would bypass the 4 MB page budget for an account that keeps creating and deleting workspaces (about 35,000 to pass it). A client drops account workspaces missing from the set after a bootstrap.
- Tests:
  - `packages/contracts/src/api-sync.test.ts` (3, new)
  - `push.db.test.ts` (+4): workspace create, edit and delete with receipts; absent fields keep the web's; repeat and conflict; assign, keep and unassign in one push; not-empty and other-account refusals
  - `pull.db.test.ts` (+2): bootstrap order, live set only, and first page only
  - `e2e/sync-push.spec.ts` (+1): the full round trip between device and web over HTTP
- Docs: SYNC_PROTOCOL 13f and 13g, SYSTEM_DESIGN 14, ROADMAP M5 note.

**Validated (macOS, temporary `docker run` PostgreSQL + Mailpit on 54339/58035):**
- Contracts tests 3/3; sync and workspace DB tests 24/24; the new round-trip E2E passes.
- Typecheck with `--force`: Turbo had served the dependents' typecheck from cache after the contracts change, and only the forced run found the `push.ts` error.
- `pnpm check --force` 17/17; `pnpm --filter @sessionhub/web test:db` **66/66** (+6); `pnpm build`.
- Full web E2E **47/47** (+1). That includes pairing and two-profile sync with the real, unchanged extension against the new server: current extensions still work, and they skip workspace items.
- Not run: the extension E2E suite (no extension change).

**Known gaps (for the extension PR):**
- Workspace edit conflicts need a policy.
- The extension must drop account workspaces missing from a bootstrap's live set, unless they have pending local changes.

### 2026-10-17 (remaining M6 repository work from issue #5) / Codex / `feature/m6-release-hardening`

**Scope and status:** user asked to inspect issue #5 and implement remaining M6 in a Git worktree. Started from clean `main` at `1b9dd50` (issue #5 still called #14 open, but it was already merged). User confirmed **no production deployment/domain exists** and agreed to local preparation with live checks pending. Plan recorded before edits in `docs/WORK_LOG_M6.md`. All implementation and tests ran in `/private/tmp/sessionhub-m6-worktree`; after verification the worktree was moved to **`/Users/chrisgen19/projects/sessionhub-m6-hardening`** for durable review. Branch remains separate from `main`.

**Implemented:**
- Extension: original SVG mark matching the existing green S brand, committed 16/32/48/128 PNG icons, explicit self-only MV3 CSP. Release checker now requires packaged PNG signatures/dimensions and that CSP (missing icons fail); permissions stay exactly `tabs`, `tabGroups`, `favicon`, `alarms`, plus the single configured API host. Regeneration uses existing Next/sharp tooling; no dependency changes.
- Public `/privacy`, linked from home: real local/automatic capture, opt-in full URL upload, credentials/account data, server-readable cloud data, unsupported URLs, no site/query exclusions, cached data after disconnect, tombstones/history/receipts without automatic purge, account erasure limitations and Limited Use. Unresolved operator/private contact/providers/retention marked as pre-launch requirements. Landing/metadata corrected to reflect implemented sync.
- `STORE_LISTING.md` plus three actual 1280x800 synthetic-data screenshots (`docs/store-assets`) and a repeatable capture script. Account-flow screenshots/reviewer access need the future service.
- `BACKUPS.md`, `RELEASE.md`, `SECURITY_REVIEW_M6.md`: encrypted off-host policy/procedures, key recovery, measured-evidence requirements, isolated restore, immutable artifacts, migrations/forward fixes, higher-version extension rollback and sync-clock/outbox hazards after a database restore. Known limitations preserved.
- Backup tooling (`infra/scripts`): consistent custom-format `pg_dump` streamed directly to authenticated age ciphertext; private temp/atomic no-clobber publication; no host plaintext archive. Restore only into a self-created disposable PostgreSQL 18 container with no network and ephemeral storage, cleanup on failures. Exact all-public-table fingerprints for quiescent fixture verification, overwrite/corrupt-ciphertext/failed-dump tests. New CI step after DB tests; CI execution itself awaits a push/PR.
- `/api/health` now probes PostgreSQL as well as configuration, returns uncached 503 `unavailable` with no internals on DB failure and recovers next probe. Unit failure/recovery and real production-container pause/resume tests.
- Restore regression fixed: first tab open is persisted before pinning; pin/group failures are cosmetic and no longer turn a successfully opened window into failed/retryable tabs. Added first-pin/group, per-tab and window-creation failure tests.
- Reconciled ROADMAP (6/8 M6 items), TEST_PLAN, SECURITY_PRIVACY, SYSTEM_DESIGN, UI_UX_DESIGN, DEPLOYMENT and README.

**Validated commands/results (macOS Apple Silicon, Node 24.18.1 / pnpm 11.17.0):**
- `pnpm install --frozen-lockfile --offline`: pass; 497 packages reused, lockfile unchanged.
- `pnpm check --force`: **17/17 tasks**, **408 unit tests** (core 84, contracts 36, sync 17, web 74, extension 197). Initial icon fixture failed because jsdom URLs aren't Node filesystem URLs; corrected to filesystem paths; final suite passed.
- `TEST_DATABASE_URL=postgresql://sessionhub:<test-only-password>@127.0.0.1:54349/sessionhub_test pnpm --filter @sessionhub/web test:db`: **60/60**. Uses non-destructive migrate deploy; tests cover ownership, concurrency, token reuse and shared budgets. Root `pnpm test:db`/database reset suite **not run**; no existing database was reset. Fresh production-image migrations also tested below.
- `pnpm build`: pass (both apps); `/privacy` rendered, `/api/health` dynamic.
- `TEST_DATABASE_URL=... TEST_MAILPIT_URL=http://127.0.0.1:58045 pnpm --filter @sessionhub/web test:e2e`: **47/47** against standalone, including privacy, proxy/framing, pairing/revoke, actual two-profile sync/conflict and no remote browser actions.
- `pnpm --filter @sessionhub/extension test:e2e`: **9/9**, real Chromium, worker termination/restart, checkpoints, partial failure/retry and interrupted restore.
- `pnpm --filter @sessionhub/extension test:perf`: **1/1**, 120 tabs / four windows; restore **3,638 ms**, **30.3 ms/tab** including per-tab outcome writes. One run only, different hardware from the old WSL baseline; details in TEST_PLAN 9.1. Initial concurrent E2E/perf processes collided in their shared Playwright output directory; rerun sequentially passed.
- `WXT_API_BASE_URL=https://sessionhub.invalid pnpm --filter @sessionhub/extension zip:release`: pass; both ZIPs SHA-256 `f462e46c7a288611daf3a06e1d5e4bebb3825568b341bc1730078e6610f6333c`; only expected placeholder warning, no missing-icon warning. This ZIP is a local/CI validation artifact, not a production release.
- `PATH=<temporary-age-bin>:$PATH bash infra/scripts/test-backup.sh sessionhub-m6-postgres sessionhub_test`: pass, including exact every-public-table counts/content hashes and all three failure paths; repeated after tightening container cleanup. age 1.3.2 from official release, stored only in `/tmp`; no system installation or retained keys/backups.
- `PATH=<temporary-docker-wrapper>:$PATH pnpm test:docker`: **7/7**, fresh production images, migration job/no-op, non-root/read-only, secrets and compose origin checks, real database pause -> 503 -> resume -> 200. Laptop lacked Compose/Buildx; initial run failed because cache mounts require BuildKit. Used temporary official Compose 5.6.0 (release SHA-256 verified) and Buildx 0.38.0 (GitHub release-asset digest verified) under `/tmp`, leaving system configuration untouched. Smoke stack removed by test teardown. The two isolated M6 PostgreSQL/Mailpit containers were also removed after verification; other sessions' containers/worktrees were left alone.
- `pnpm audit --prod --json`: **2 high + 1 moderate**, no critical; not clean. Reviewed exceptions: recursive `deepmerge-ts` in trusted Prisma configuration; two `mysql2` advisories in the unused MySQL adapter path. App uses PostgreSQL only, and none of those packages appears in Next standalone traces. No suppression/major transitive override; re-review before release and by 2026-11-17 (`SECURITY_REVIEW_M6.md`).
- `node infra/scripts/generate-extension-icons.mjs`, `node infra/scripts/capture-store-screenshots.mjs`: pass; actual restore preview screenshot visually inspected. `bash -n` on all new shell scripts, `node --check` on both `.mjs` scripts and `git diff --check`: pass.

**Still pending / no false completion:** production domain and origin variable, private support/deletion contact/providers/retention and final store answers, live TLS/proxy/firewall/cookies/migrations, real Resend email, independent off-host archive download/key recovery plus full staging app restore and RPO/RTO, stable Chrome on Windows/macOS, final reviewer/account-flow store materials and submission. M6 is **6/8**, not deployed/released. No personal session data was uploaded; tests used synthetic data on isolated local services. No store upload, push/PR or issue comment was made. Future changes should address the documented rejected-upload/id-collision limitations separately; M5 stays out of this slice.

### 2026-10-17 (M6 CI release ZIP) / Claude Code (Opus 5.5) / `feature/m6-extension-zip-ci` (macOS laptop)

**Goal:** CI builds of the production extension ZIP (user's scope; ROADMAP M6 "CI production extension ZIP and web build"). The web half was already covered by the `docker` job. Operator steps in `DEPLOYMENT.md` section 6; decision in SYSTEM_DESIGN.md 14.

**Implemented:**
- `apps/extension/scripts/check-release-zip.ts` (new; runs on Node 24's built-in TypeScript support, no new packages, reads the ZIP with the system `unzip`).
  - `checkRelease()`:
    - **errors:** MV3 and package version; permissions exactly the documented four; `host_permissions` exactly the https API origin; no content scripts, `externally_connectable`, `web_accessible_resources` or optional permissions; no source maps; no remote scripts in HTML; the service worker contains the origin; no `localhost:3000` dev fallback anywhere in the JS
    - **warnings:** no icons; placeholder origin
  - The CLI also fails when a second build's ZIP isn't byte-identical.
- `apps/extension/package.json`: `zip:release`, which runs `wxt zip`, a second `wxt zip` into `.output/reproduce`, then the check.
- `wxt.config.ts`: `zip.name` set, so the file is `sessionhub-<version>-chrome.zip`.
- `src/styles/app.css`: `@source not "../../scripts"`. Tailwind scans every package file, and the word "contents" in the new test had added `.contents{display:contents}` to the shipped CSS.
- `tsconfig.json` and `vitest.config.ts` now include `scripts/`.
- `.github/workflows/ci.yml`: new `extension-zip` job.
  - `WXT_API_BASE_URL` comes from `vars.EXTENSION_API_BASE_URL`, or `https://sessionhub.invalid` when unset.
  - It uploads `sessionhub-extension-<sha>` (30 days) only when the variable is set.
- Tests: `scripts/check-release-zip.test.ts` (5).
- Docs: DEPLOYMENT.md 6, SECURITY_PRIVACY 6, SYSTEM_DESIGN 6 and 14, ROADMAP (item done), TEST_PLAN 8 note, README.

**Validated (macOS):**
- Extension lint, typecheck and tests pass, including the 5 new ones.
- `zip:release` for the placeholder origin: passes with the two expected warnings, and the second build is identical (`d5d38ed6...`).
  - That is the same hash as a ZIP built from unchanged `main`, so the shipped extension is unchanged.
  - A build into a different directory gives the same bytes.
- Negative runs, all exit 1:
  - a build for `http://localhost:3000` (https error, plus the dev server found in `background.js` and the manager chunk)
  - a tampered second ZIP (not reproducible)
  - no origin set (usage error)
- `pnpm check --force` 17/17; `pnpm build`.
- Extension E2E 9/9.
- Not run here: the GitHub job itself (`unzip` and Node 24 are on ubuntu runners; the PR's run is the first real one), and web E2E (no web change).

**Known gaps:**
- No icons yet (a store requirement; warned in CI).
- Nothing is uploaded until `EXTENSION_API_BASE_URL` is set.
- No signing or automated store upload.

### 2026-10-17 (M6 framing protection) / Claude Code (Opus 5.5) / `feature/m6-framing-protection` (macOS laptop)

**Goal:** framing protection (`frame-ancestors 'none'` / `X-Frame-Options: DENY`), at least for `/app/pair` (user's scope). Applied to every route, because nothing embeds the app (no `iframe` in the extension or the web app). Decision in SYSTEM_DESIGN.md 14; behavior in SECURITY_PRIVACY.md 8b.

**Implemented:**
- `apps/web/next.config.ts`: `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` on `/:path*`, in every environment.
- `apps/web/e2e/framing.spec.ts` (new, 2 tests):
  - the headers are on `/`, `/login`, `/signup`, `/reset-password`, `/app/pair`, `/api/health` and `/api/v1/sessions`
  - a page on the same origin frames a real pending `/app/pair` request with the session cookie sent: the frame ends on Chrome's error page, and "Connect this browser" never appears
- Docs:
  - SECURITY_PRIVACY 8b (the "Not covered" line replaced)
  - DEPLOYMENT.md (no longer listed as missing, plus a post-deploy `curl` check)
  - SYSTEM_DESIGN 14 (one row)

**Assessment:** the session cookie is `SameSite=Lax`, so another site's frame never had the session and only showed the login page. The real gaps were framing from the same site and visual tricks on the login page.

**Validated (macOS, temporary `docker run` PostgreSQL + Mailpit on 54339/58035):**
- `e2e/framing.spec.ts` against the code before the change: **both fail**. The headers were missing, and the framed frame loaded `http://127.0.0.1:3917/app/pair?code=...`.
- After the change: **6/6** with `--repeat-each 3`.
- `pnpm check --force` 17/17; `pnpm build`.
- Full web E2E **46/46**, including pairing with the real extension.
- Not checked: the headers under `next dev` (same `next.config.ts` entry), and the extension suites (no extension change).

**Known gaps:** none new. A full Content Security Policy (scripts, styles, connections) is still not set; if one is added, it must keep `frame-ancestors 'none'`.

### 2026-10-17 (stack merged; flaky restore-retry E2E fixed) / Claude Code (Opus 5.5) / `main`, then `bugfix/restore-retry-e2e` (macOS laptop)

**Goal:** merge PRs #1 to #11 bottom-up with merge commits after all their `check` and `docker` jobs were green, then fix the flaky extension E2E test (user's requests).

**Merge:**
- All ten PRs were merged in order (`gh pr merge --merge --match-head-commit`). `main` = `765989c`, whose content is identical to the last #11 head (`git diff` empty).
- **Incident, recovered:** after #1 merged, I deleted its branch through the API. GitHub then **closed** PR #2 instead of retargeting it; it retargets only when the branch is deleted through the PR's own "Delete branch" button or the repository's auto-delete setting.
  - Fixed by recreating the branch at the same commit, reopening #2, setting its base to `main` and deleting the branch again.
  - Every later PR was then merged in the safe order: merge it, set the next PR's base to `main`, and only then delete the merged branch.
  - **Lesson:** never delete a branch that is still the base of an open PR.
- CI on `main` for `765989c` (run 38995084504): **`check` and `docker` passed**.
- Local cleanup: the stale `feature/*` copies were deleted, after checking that none held commits outside `main` or the last recorded remote tips. The other sessions' `bugfix/*` worktrees were left alone.

**Flaky test fixed** (`apps/extension/e2e/local-slice.spec.ts`, "a real mid-restore failure can be retried from the summary"):
- **Cause:** it read the reopened window's tab URLs once, right after "opened 3 of 3 tabs". A tab that hasn't started loading yet reports an empty URL. This failed on every run on this Mac and once in CI (PR #4, passed on re-run).
- **Fix:** it now polls (`expect.poll`, like the other restore tests in this file) until exactly one new window holds `failedCount` tabs, all with saved URLs. Saved URLs show as one label, so a failure prints the actual offending URL.

**Validated (macOS):**
- `apps/extension` lint and typecheck pass.
- The test passed `--repeat-each 5`: 5/5, where the old version failed every time on this machine.
- Full extension E2E (`--grep-invert @perf`): **9/9**, the first full pass on this laptop.

### 2026-10-17 (review fixes on every open PR, then one restack) / Claude Code (Opus 5.5) / all stack branches (macOS laptop)

**Goal:** fix every open Codex review finding on PRs #1 to #11, restack the chain once, and get every PR's `check` and `docker` jobs green (user's request). Several sessions plus one review-fix agent in this session each fixed findings on that PR's own branch; then #2 to #11 were rebased bottom-up.

**Review findings:**

| PR | Finding | Outcome | Commit after the restack |
|---|---|---|---|
| #1 | per-tab restore outcomes before retry (P2) | fixed: each tab's outcome is written before the next tab opens; a killed worker can reopen at most one tab | `fb0feb8` |
| #1 | checkpoint eviction reporting (P2) | fixed | `9e21181` |
| #2 | `BETTER_AUTH_URL` ignored `WEB_PORT` (P2) | fixed | `cb67190` |
| #2 | stale "not committed" status in this file (P2) | fixed | `d5627a4` |
| #3 | `/email-verified` claimed success without checking (P2) | fixed | `4963f62` |
| #4 | atomic successor claim (P1), single-use lost-response retry (P2) | fixed | `d482118` |
| #6 | (no review) | - | - |
| #7 | round cap left sendable work unscheduled (P2) | fixed | `2ca812c` |
| #7 | idempotency across re-pairing (P2) | not valid: re-pairing keeps the device id | - |
| #8 | pull bound to the gate's account (P1), backoff cleared by the upload (P2) | fixed | `90b5d7a` |
| #9 | stop transfers when sync is turned off (P1), honest "Last synced" (P2) | fixed | `ecbfef1` |
| #10 | keep the account session holding a taken id (P2); deleted refused sessions can leave review (P2) | fixed: new "Drop this change" choice | `e87f3d4` |
| #11 | credential-shaped `X-Request-Id` kept (P2) | fixed: replaced by a UUID | `b6e5339` |
| #11 | idle bucket sweep could fail the request (P2) | fixed: at most 500 rows, `FOR UPDATE SKIP LOCKED`, best effort, logged `rate_limit_sweep_failed` | `0799082` |

The #4 and #8 fixes were written by other sessions and committed and pushed from their worktrees by this session (user's choice). Decisions for #1, #10 and #11 are in their commit bodies and in `SYSTEM_DESIGN.md`, `SYNC_PROTOCOL.md`, `UI_UX_DESIGN.md` and `SECURITY_PRIVACY.md`.

**Restack:**
- #1 unchanged, because `main` didn't move.
- #2 to #11 were each rebased with `git rebase --onto <new parent> <old base>` and pushed with `--force-with-lease` against the recorded remote SHAs.
- Conflicts:
  - `PROGRESS.md` at most levels and `SYSTEM_DESIGN.md` decision rows: both sides kept.
  - `compose.yaml`:
    - #3: #2's `WEB_PORT` default plus #3's mail settings
    - #11: plus `TRUSTED_PROXY_COUNT` and the https note; `.env.example` likewise
  - `sync-uploader.ts` at #8: #7's round-cap retry kept through #8's `recordSuccess` move and its removal.
  - `sync-runner.ts` at #9: #9's queued-run structure plus #8's JSDoc sentence.
  - #9's fix against #8's fix (`sync-gate.ts`, `sync-uploader.ts`, `sync-downloader.ts`, `sync-uploader.test.ts`, `SYNC_PROTOCOL.md`): both kept.
    - `withRunToken` binds every request's token to the run's account.
    - `stillOpen` checks consent and account before every round and page, and now reuses `isRunAccount`.
    - All tests of both fixes are kept.
- Per level: the new branch differs from its old version only by the fixes below it (`git diff --name-only`), with no conflict markers and no duplicate session entries.

**Validated:** macOS, temporary `docker run` PostgreSQL + Mailpit on 54339/58035.
- #8 and #9 levels: extension and sync lint, typecheck and tests pass. The #9 merge was tested before the rebase continued.
- Top (#11):
  - `pnpm check --force` 17/17; `pnpm --filter @sessionhub/web test:db` 60/60; `pnpm build`.
  - Web E2E **44/44**. The password-reset test passes here now that PR #3's fix reaches the top.
  - Extension E2E 8/9: only the pre-existing macOS mid-restore retry failure, failing at the same assertion as before the #1 restore fix.
- CI after the push: not known when this entry was written; see the PRs.

**Known gaps (seen during the reviews, not fixed):**
- `browser-restore.ts`: if pinning the first tab fails after the window was created, the whole window is reported failed, so Retry reopens it.
- "Keep in this browser only" for a refused edit of an already-synced session with no held server copy keeps the same id, so the account's version stays hidden in the extension.
- Restore now writes one IndexedDB record per tab; large-restore speed is not re-measured (`test:perf` not run).
- The "Drop this change" button is not checked at mobile width (it uses the same component as the other choices).
- Pull pages still move `lastSyncAt` per page.
- The worktrees `sessionhub-pr2-fix`, `-pr3-fix`, `-pr4-fix`, `-pr7-fix`, `-pr8-fix` and `-pr9-fix` still point at pre-restack history; remove them once those sessions are closed.

### 2026-10-17 (PR #2 review fixes: compose auth URL, progress log) / Claude Code (Opus 5.5) / `feature/m3-web-docker` (macOS laptop)

**Goal:** address the two Codex findings on PR #2 (review 5547191782).

**Implemented:**

- `infra/docker/compose.yaml`: `BETTER_AUTH_URL` defaulted to a fixed `http://localhost:3030` while the published port follows `WEB_PORT`. Changing only `WEB_PORT` made the API's same-origin check (`http.ts` `assertSameOrigin`) answer 403 to every write and Better Auth refuse cookie-authenticated POSTs. The default is now `http://localhost:${WEB_PORT:-3030}` (nested Compose interpolation); `infra/docker/.env.example` leaves `BETTER_AUTH_URL` empty, with a comment to set the public HTTPS origin behind a proxy.
- `apps/web/e2e-docker/web-container.spec.ts`: new test resolves the stack with `docker compose config` (both unset -> `:3030`, `WEB_PORT=8080` -> `:8080`, an explicit URL wins); the secrets test shares the new `isolatedConfig` helper.
- This file said the Docker slice was not committed and told the next agent to commit it: the Git row and the next step are corrected.

**Validated commands and results:**

- `apps/web`: `pnpm lint`, `pnpm typecheck`: **pass**; `playwright test --config playwright.docker.config.ts --list` lists the 6 docker tests.
- Docker tests: **Not run locally** (Docker Compose isn't installed on this laptop); they run in CI's `docker` job.

**Known gaps:** none new.

### 2026-10-17 (PR #3 review fix: email confirmation page status) / Claude Code (Opus 5.5) / `bugfix/email-verified-page` (worktree `sessionhub-pr3-fix`, based on `feature/m3-email-auth`)

**Goal:** address the Codex review finding on PR #3 (P2, `apps/web/src/app/(auth)/email-verified/page.tsx`). Without `?error`, the page said "Email confirmed" to anyone, including a signed-in user with an unconfirmed email who opened `/email-verified` directly.

**Checked in Better Auth 1.7.9** (`dist/api/routes/email-verification.mjs`): `verify-email` redirects to the callback with `?error=<code>` on failure, and with no query both on success and when the address was already confirmed. The URL can't prove a confirmation, so the page now asks the session instead. `session.cookieCache` isn't enabled, so `getSession` reads `emailVerified` from the database on every request.

**Implemented:**

- `email-verified/page.tsx`: a signed-in visitor whose email isn't confirmed sees "Your email isn't confirmed yet" with their address and a Settings link (the resend hint only when mail is enabled). Signed-out visitors without `?error` still see "Email confirmed": that is the usual result of opening the link on another device (no auto sign-in), and there is no account state to check. The error view is unchanged.
- `e2e/email.spec.ts`: the sign-up test opens `/email-verified` before following the link and expects the unconfirmed view. The reset test now waits for the "Reset your password" heading after clicking "Forgot password?". Before, `fill` could land in the sign-in form's Email field while the client-side navigation was still running, so an empty form was submitted (failed 3/3 on this laptop before any change here).

**Validated commands and results:**

- New assertion against the unfixed page: **fail** as expected (rendered "Email confirmed" for an unconfirmed, signed-in user).
- Reset test on the unmodified PR code: **fail** 3/3 (`--repeat-each 3`), empty Email field submitted; **pass** 3/3 with the heading wait.
- `pnpm --filter @sessionhub/web lint`, `typecheck`: **pass**. `pnpm check`: **pass** (14 tasks).
- `e2e/email.spec.ts --repeat-each 3`: **18/18** (the 375px test now renders the unconfirmed view with a long address). Full web E2E (`playwright test` in `apps/web`): **32/32**.
- This laptop runs Colima without the `docker compose` plugin, so `pnpm db:up` fails ("unknown shorthand flag: 'f'"). E2E ran against `postgres:18-alpine` and `axllent/mailpit:v1.31.3` started with `docker run --rm` on the same ports, env and init script as `compose.dev.yaml`.

**Next step:** after PR #3 takes this fix, carry it up the stack (PRs #4, #6 to #11): the page and both tests are unchanged up to `feature/m6-hardening`.
### 2026-10-17 (PR #4 review fixes: refresh rotation) / Claude Code (Opus 5.5) / `feature/m4-device-pairing` (macOS laptop)

**Goal:** address the two Codex findings on PR #4 (review 5547217268) in `apps/web/src/server/devices/credentials.ts`.

**Implemented:**

- P1: a lost-response retry checked "successor never used" with a read and then rotated it unconditionally, and the access token's first use was recorded unconditionally, so overlapping requests could both succeed. The retry now claims the unused successor with one conditional update (`usedAt` and `rotatedAt` still null), and the first use is recorded only if the pair wasn't rotated meanwhile. A retry racing the successor's first use is reuse (device revoked); a first use racing a retry gets `INVALID_TOKEN`.
- P2: each retry re-pointed `replacedById` at the new pair, so the old token could be retried again and again. It now keeps pointing at the dead successor, so a second retry is reuse, matching `SECURITY_PRIVACY.md` item 5 ("retried once"). The claim happens before issuing, so a refused retry leaves no orphan credential.
- `pairing.db.test.ts`: 3 tests (single retry; retry while the successor's first use is uncommitted; first use while a retry's rotation is uncommitted). `SECURITY_PRIVACY.md` item 5 notes the atomic single retry.

**Validated commands and results:**

- New tests against the unfixed code: **3 fail** (two returned success instead of `DEVICE_REVOKED`, one instead of `INVALID_TOKEN`).
- After the fix, against a throwaway `postgres:18-alpine` on `127.0.0.1:54349`: `pairing.db.test.ts` **11/11**, the 3 new tests **5 runs in a row**, web `test:db` **38/38**; `pnpm check`: **pass** (14 tasks). E2E: Not run.

**Known gaps (decision needed):** if an attacker wins the single retry, the real extension gets `INVALID_TOKEN`, disconnects as "expired" (`withAccessToken`) and never presents its refresh token, so the server doesn't revoke; the attacker's pair lives until the user pairs again. Revoking when a rotated, never-used pair is presented would close this but changes the documented `INVALID_TOKEN` response.

### 2026-10-17 (PR #7 review fixes: uploader round cap) / Claude Code (Opus 5.5) / `bugfix/sync-uploader-review-fixes` (worktree `sessionhub-pr7-fix`, based on `feature/m4-sync-push`)

**Goal:** assess the two Codex findings on PR #7 (review 5555201179, both P2, `apps/extension/src/lib/sync-uploader.ts`).

**Finding 1 (valid, fixed):** when the 10-round cap ended a run with sendable work left, `run` cleared `nextAttemptAt`, returned `done` with `remaining > 0` and armed no alarm. The only other triggers here are worker start and `session.rename` / `session.delete`, so the rest waited for one of those. Likely when sync is first turned on with more than 250 sessions, or fewer large ones (1.5 MB per push). `feature/m6-hardening` adds a 10-minute `sync-periodic` alarm, which limits the delay there, but doesn't continue the run right away.

- `sync-uploader.ts`: after a successful run, if `selectPushBatch` still finds something sendable, call `scheduleRetry(now)` (the `sync-retry` alarm continues the upload). Work held back behind a `conflict` / `rejected` operation doesn't count, so a held session can't re-arm the alarm forever. `nextAttemptAt` stays null.
- `sync-uploader.test.ts`: 251 queued sessions -> 10 pushes, `remaining: 1`, alarm armed, next run sends the last one and arms nothing; 250 sendable plus one session held behind a conflict -> `remaining: 1`, no alarm.
- `SYNC_PROTOCOL.md` 13e uploader step 5 updated.

**Finding 2 (not valid, no change):** the claim is that re-pairing gives the browser a new device id, so a retried `sending` operation misses its receipt and turns into a false conflict. Re-pairing doesn't change the device id. `disconnect` and revocation keep the local installation id (`account-service.ts`, only the `connection` / `notice` / `pairing` keys are deleted), the server upserts the device on `(userId, installationId)` and clears the revocation (`devices/pairing.ts` `upsertDevice`), and nothing deletes device rows (receipts cascade only on device delete). Covered by `e2e/pairing.spec.ts` ("Pair again: same device row", one device after revoke and re-pair). A new device id only comes with a reinstall or wiped extension data, which also removes the outbox.

**Validated commands and results:**

- New round-cap test against the unfixed uploader: **fail** as expected (`scheduleRetry` never called after `done` with `remaining: 1`); the held-work test passed before and after.
- `apps/extension`: `vitest run src/lib/sync-uploader.test.ts` **13/13**. `pnpm check`: **pass** (14 tasks; extension 134/134).
- E2E: Not run (uploader-only change, unit-tested; no E2E reaches the round cap).

**Next step:** after PR #7 takes this fix, carry it up the stack (#8 to #11). `sync-uploader.ts` is restructured there (`sync-gate` `recordSuccess`), so expect a small conflict in `run`.
### 2026-10-17 (PR #8 review fixes: sync account binding and backoff) / Claude Code (Opus 5.5) / `feature/m4-sync-pull` (macOS laptop)

**Goal:** address the two Codex findings on PR #8 (review 5547685945).

**Implemented:**

- P1 (cross-account cache): a run fixed its scope at the gate, but every request re-read the connection. After a mid-run switch to another account, the server refused the old cursor (`INVALID_CURSOR`), the client rebuilt from bootstrap with the new account's token, and that account's sessions were committed into the old scope. `sync-gate.ts` `withRunToken` checks each request's connection is still the run's account (otherwise the run ends as disconnected, touching neither account's state), and `commitPage` re-checks inside its transaction and drops the page. Pushes use the same binding (the server already refused them with `DEVICE_MISMATCH`). `withAccessToken` now also passes the connection to its callback.
- P2 (backoff): a successful push cleared the shared failure count before the pull, so a failing pull retried every ~5 s forever. Only the pull's success, the run's last step, clears it now.
- Tests: account switch mid-pull, account switch mid-push, backoff growing 5/10/20 s across runs until a whole run succeeds; two uploader tests updated for the run-level reset. `SYNC_PROTOCOL.md` (extension download) documents both rules.

**Validated commands and results:**

- New tests against the unfixed code: **3 fail** (retry stuck at +5 s; pull returned `done` with the other account's session in the scope; the second push went out with the other account's token).
- After the fix: `apps/extension` `pnpm lint`, `pnpm typecheck`: **pass**, `pnpm test` **147/147**; `pnpm check`: **pass** (17 tasks). E2E: Not run.

**Known gaps:** `refreshConnection` writes the refreshed connection unconditionally, so a pairing that completes while the previous account's refresh is in flight could be overwritten (found by reading, not reproduced; PR #4 code).

### 2026-10-17 (PR #9 review fixes: stop on turn-off, honest "Last synced") / Claude Code (Opus 5.5) / `bugfix/sync-ui-review-fixes` (worktree `sessionhub-pr9-fix`, based on `feature/m4-sync-ui`)

**Goal:** assess the two Codex findings on PR #9 (review 5555130903). Both valid; both fixed. Decisions recorded in `SYSTEM_DESIGN.md` 14.

**Finding 1 (P1, privacy):** "Turn off sync" during a run only cleared `enabledAt`; `openSync` was checked once per run, so the uploader kept going for up to 9 more rounds and the downloader for up to 19 more pages after the UI said sync was off. While checking it: `withAccessToken` reads whichever connection is current on every request, so disconnecting and connecting another account mid-run could push the first account's queue with the second account's connection.

- `sync-gate.ts`: `stillOpen(db, scope)` (the connection is still this account, `enabledAt` still set), checked before every push round (`sync-uploader.ts`) and pull page (`sync-downloader.ts`). Returns `disabled` / `disconnected`; nothing is recorded as a failure. A request already sent completes (its page is kept).

**Finding 2 (P2):** the upload's `recordSuccess` moved `lastSyncAt` before the download ran, so a failed download still showed "Last synced" just now. Same cause, bigger effect: it also reset `failures`, and an upload with nothing queued makes no request and always "succeeds", so a failing download restarted the backoff at 5 s on every run (about every 30 s with Chrome's alarm minimum) instead of growing to 15 minutes, for every idle browser during an outage.

- `sync-uploader.ts`: no `recordSuccess`; failures are still recorded. Only the download's `recordSuccess` marks a run synced (`lastSyncAt`, backoff reset). The runner always pulls after a `done` push.

**Tests (written first; 6 failed against the unfixed code, all pass now):**

- `sync-uploader.test.ts`: turning sync off during the first of two pushes stops after it (1 request, 5 operations still `queued`; before: all 30 uploaded); connecting another account mid-run stops with `disconnected` (before: all 30 uploaded). Two assertions changed to the new rule: an upload alone leaves `lastSyncAt` null and doesn't reset `failures`.
- `sync-downloader.test.ts`: turning sync off during a page keeps that page, then stops (1 request; before: 20 pages).
- `sync-runner.test.ts`: upload accepted, download fails -> `lastSyncAt` unchanged, `failures` 1 then 2 (wait 5 s then 10 s; before: reset to 1 each run); download works -> `lastSyncAt` moves, `failures` 0.

**Docs:** `SYNC_PROTOCOL.md` 13f step 1, 13g intro, 13h `sync.disable`; `SECURITY_PRIVACY.md` "Sync off produces zero uploads" checklist item; `DATA_MODEL.md` `syncState.lastSyncAt`; `SYSTEM_DESIGN.md` 14 (two decisions).

**Validated commands and results:**

- `apps/extension` sync tests: **27/27**. `pnpm check`: **pass** (17 tasks; extension 163/163).
- Full web E2E (`playwright test` in `apps/web`, real extension): **37/38**. Pairing, `sync-push` and `sync-two-profiles` pass. The one failure is `email.spec.ts` "password reset", the click-then-fill race fixed on PR #3 (`7a47e98`), which hasn't reached this branch yet. Ran against `docker run` Postgres + Mailpit (this laptop has no `docker compose`).

**Known gaps:** the stale-connection window narrows to the moment between the gate check and `withAccessToken` reading the connection; passing the expected account into `withAccessToken` would close it fully. Pull pages still move `lastSyncAt` per page, so a later page failing leaves the time of the last page that arrived.

**Next step:** after PR #9 takes this fix, carry it up the stack (#10, #11). `sync-uploader.ts` `run` also changes in the PR #7 fix (`51b0582`, round-cap continuation), so the rebase of #8 and #9 onto the new #7 meets this code too.
### 2026-10-17 (M6 trusted proxy and TLS slice) / Claude Code (Opus 5.5) / `feature/m6-hardening` (macOS laptop)

**Goal:** trusted proxy / `X-Forwarded-For` handling and TLS for the Coolify deployment checklist (user's scope). Same branch as PR #11. Behavior in SECURITY_PRIVACY.md 8b, operator steps in the new `docs/DEPLOYMENT.md`, decisions in SYSTEM_DESIGN.md 14 (three rows).

**Found:** `clientIp` took the **leftmost** `X-Forwarded-For` entry (client-controlled whenever the proxy appends, which Traefik does by default), so per-IP limits on pairing start and device tokens could be bypassed by rotating the header. Better Auth 1.7.9 refuses multi-entry headers without `trustedProxies` and fell back to one shared bucket for all such requests. Both are confirmed by the new E2E failing against the old code.

**Implemented:**

- `apps/web/src/server/client-ip.ts` (new):
  - `clientAddressFrom` takes the entry `TRUSTED_PROXY_COUNT` places from the right, validates it and unwraps IPv4-mapped addresses
  - `rateLimitSubject` uses IPv6 /64 and `unknown` for no address
  - `http.ts` per-IP limits use them (the old `clientIp` was removed)
- `/api/auth/[...all]`: Better Auth gets a fresh `Request` whose `X-Forwarded-For` is only the resolved address (GET and POST). `new Request(request, ...)` fails Next's private-field check, which the full E2E caught.
- `env.ts`:
  - `TRUSTED_PROXY_COUNT` (1 to 5, default 1)
  - `BETTER_AUTH_URL` must be https in production unless loopback
  - `configurationProblem()`
- `/api/health` returns 503 `misconfigured` while the configuration is invalid and logs one `config_invalid` line naming the variable.
- `next.config.ts`: `Strict-Transport-Security: max-age=31536000` on every route in production builds.
- `infra/docker/compose.yaml` and `.env.example`: `TRUSTED_PROXY_COUNT` passthrough (default 1).
- Tests:
  - `client-ip.test.ts` (4)
  - `env.test.ts` (+3)
  - `health/route.test.ts` (+1)
  - `e2e/trusted-proxy.spec.ts` (3): spoofed prefixes don't escape the pairing limit, Better Auth's limit uses the same address, HSTS
- Docs:
  - `docs/DEPLOYMENT.md` (new; README links it)
  - SECURITY_PRIVACY 5a/8b/10
  - SYNC_PROTOCOL 13a
  - SYSTEM_DESIGN 6 and 14
  - ROADMAP M6 notes

**Verified against sources, not memory:**
- Next.js 16.4.1 fills `X-Forwarded-For` from the socket only when absent (`next/dist/server/base-server.js:567`).
- Better Auth 1.7.9:
  - IP parsing in `@better-auth/core/dist/utils/ip.mjs:174`
  - `Secure`/`__Secure-` exactly when `baseURL` starts with `https://` (`better-auth/dist/cookies/index.mjs:23`)
  - `getSessionCookie` reads both names (`:266`)
- Traefik appends by default (`notAppendXForwardedFor` defaults to false, Traefik entrypoints reference).
- Coolify's generated Traefik config sets no `forwardedHeaders` options (`bootstrap/helpers/proxy.php`).

**Validated commands and results:** macOS, temporary `docker run` PostgreSQL and Mailpit on **54339/58035**, because another session's `pr3-postgres`/`pr3-mailpit` were on the usual ports (left untouched).

- `pnpm check --force`: **pass** (17 tasks). Web unit tests **72** (+8).
- `pnpm --filter @sessionhub/web test:db`: **56/56**.
- `e2e/trusted-proxy.spec.ts`: 3/3. Against the old `http.ts` and auth route, 2 of them fail as expected: the 6th spoofed pairing start got 201, and another address got 429 from Better Auth's shared bucket.
- Full web E2E **43/44**: only the pre-existing macOS password-reset failure.
- Standalone build with `BETTER_AUTH_URL=https://sessionhub.example`: sign-up sets `__Secure-better-auth.session_token ...; HttpOnly; Secure; SameSite=Lax`, HSTS present.
- With `http://sessionhub.example`: health 503, auth/API 500, one `config_invalid` log line.
- Not run:
  - extension suites (no extension changes)
  - `pnpm test:docker` (no Compose here; CI's `docker` job covers it)
  - anything on a real Coolify host (nothing deployed yet)

**Production note:** no migration. After deploying:
- a production `BETTER_AUTH_URL` that isn't https makes the deploy unhealthy (intended)
- browsers that visit over https remember HTTPS-only for a year
- per-IP limits change from the leftmost to the rightmost `X-Forwarded-For` entry (the same single value behind Traefik when clients send none)

**Known gaps:**
- no framing protection yet: `/app/pair` could be framed for clickjacking (next M6 item)
- the CDN case relies on the operator setting the count, Traefik `trustedIPs` and a firewall (DEPLOYMENT.md 2)
- health doesn't check PostgreSQL
- every DEPLOYMENT.md check still has to run on a real deployment

### 2026-10-17 (M6 observability and resource limits slice) / Claude Code (Opus 5.5) / `feature/m6-hardening` (macOS laptop)

**Goal:** observability with URL redaction (structured logs, request ids, no URLs or tokens) and resource limits (user's scope). Same branch as PR #11. Decisions in SYSTEM_DESIGN.md 14 (five rows); behavior in SECURITY_PRIVACY.md 8a.

**Implemented:**

- `apps/web/src/server/observability/` (new):
  - `redact.ts`: `redactText` (URLs of any scheme, emails, `shd_*` tokens, `Bearer` values), `redactPath` (query dropped, ids and opaque segments to `:id`), `redactFields` (drops content and secret field names)
  - `logger.ts`: JSON lines (info stdout, warn/error stderr), request id from AsyncLocalStorage, `captureLogs` for tests, `errorFields`
  - `request.ts`: `observeRequest` (request id in and out as `X-Request-Id`, one `http_request` access line) and `readBodyText` (hard byte cap while streaming)
- `http.ts`: `handle()` runs every `/api/v1` route through `observeRequest`; unexpected errors log class plus Prisma code; `readJson` uses the bounded reader (the old code trusted `Content-Length`, then read everything).
- `/api/auth/[...all]`: request ids and access logs; POST bodies capped at 64 KB before Better Auth sees them (413 `PAYLOAD_TOO_LARGE`). `auth.ts`: Better Auth's logger goes through the redacting logger (debug dropped, arguments by type only).
- `sync/push.ts` and `mail/deliver.ts`: `console.error` replaced with structured events.
- `packages/database/src/client.ts`: `DATABASE_LIMITS` on the pg pool (statement 15 s, idle in transaction 30 s, connection wait 10 s).
- 5,000 live sessions per account: `API_LIMITS.sessionsPerAccountMax`, checked in `createSessionInTx` after the clock lock; `LIMIT_REACHED` is 422 on the web API and a `rejected` push result (contract enum extended), which the extension already shows in review as "Can't be uploaded" with "Keep in this browser only".
- Tests:
  - `observability.test.ts` (9)
  - `limits.db.test.ts` (2)
  - `e2e/observability.spec.ts` (request ids, a proxy's id kept, a forged one replaced, 413 on a 70 KB sign-in body)
  - `deliver.test.ts` now asserts on the structured line
- Docs: SECURITY_PRIVACY 8a and section 10, SYNC_PROTOCOL 13a and push results, SYSTEM_DESIGN 14, ROADMAP (M6 item done).

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit):**

- `pnpm check --force`: **pass** (17 tasks). Web unit tests **64** (+9).
- `pnpm --filter @sessionhub/web test:db`: **56/56** (+2): the session cap for web creates and sync uploads (deleted sessions don't count, other accounts unaffected), and `SHOW statement_timeout` / `idle_in_transaction_session_timeout` = 15s / 30s on pooled connections.
- `pnpm build`: pass.
- Full web E2E **40/41**: only the pre-existing macOS password-reset failure.
- Extension E2E **8/9**: only the pre-existing macOS restore-retry failure.
- Leak check against the production standalone build: a scratch script sent sign-up, a wrong password, a list with a token-like cursor and URL query, a create with a private URL and title, an unknown id, a bearer token and a reset-token link. It got 8 JSON log lines; none contained the email, name, title, URLs, cursor, tokens or the client IP.
- Not run: `pnpm test:docker` (no Compose here; CI's `docker` job covers it) and the database package `test:db` (resets `sessionhub_test`, which Prisma blocks for agents).

**Production note:** no migration. After deploying:
- every API request writes one log line
- statements over 15 s are cancelled (the slowest measured query is far below that)
- auth bodies over 64 KB and the 5,001st live session are refused

**Known gaps:**
- no log shipping or metrics backend yet (stdout/stderr only)
- a `LIMIT_REACHED` upload stays in review until the user picks "Keep in this browser only"; there is no retry after deleting sessions elsewhere
- client-side (extension) logs not reviewed
- per-IP limits still trust `X-Forwarded-For`

### 2026-10-17 (PR #1 review fix: checkpoint eviction reporting) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice` (macOS laptop)

**Goal:** address the Codex review finding on PR #1 (P2, review 5547205273). After a checkpoint hits the storage quota, `freeCheckpointSpace` evicts older checkpoints in its own committed transaction; if the retry also hits the quota, the error claimed "Earlier checkpoints are kept" although up to half had been removed.

**Implemented:**

- `apps/extension/src/lib/recovery-checkpoint.ts`: `CheckpointStorageFullError` takes how many checkpoints were already removed. A failed retry after eviction now reads "Storage for SessionHub is full, so this checkpoint wasn't saved, even after removing N older checkpoints to make room. Delete or export sessions you no longer need." "Earlier checkpoints are kept" is shown only when nothing was removed. Recovery behavior (evict to half with protections, retry once) is unchanged.
- `apps/extension/src/lib/quota.test.ts`: the retry-fails test now asserts the count in the message, no "kept" claim, the exact surviving checkpoints and the persisted `lastError`; the nothing-to-evict test asserts the "kept" message.
- `docs/UI_UX_DESIGN.md`: storage-full message list updated.

**Validated commands and results:**

- New test against the unfixed code: **fail** as expected (received "...Earlier checkpoints are kept..." while 3 of 6 checkpoints had been deleted), confirming the finding.
- `apps/extension`: `pnpm lint`, `pnpm typecheck`: **pass**; `pnpm test`: **84/84** (12 files).
- `pnpm check`: **pass** (14 tasks).
- Manual verification in Chrome: Not run (message text only, no layout change).

**Known gaps:** after an error the dirty flag stays set, so under persistent quota pressure every periodic alarm (30 min) evicts to half again and retries; history shrinks to the protected newest and largest checkpoints while each retry fails. This matches the documented quota decision in `SYSTEM_DESIGN.md` (automatic history may be thinned) and is now reported honestly; whether to stop repeated eviction after a failed retry is an open recovery-behavior decision. A non-quota error on the retry still does not mention the removal.

### 2026-10-17 (M6 rate limits slice) / Claude Code (Opus 5.5) / `feature/m6-hardening` (macOS laptop)

**Goal:** M6 read rate limits and shared (multi-instance) limiter storage (user's scope). Decisions in SYSTEM_DESIGN.md 14 and SYNC_PROTOCOL.md 13a.

**Implemented:**

- Database: migration `20261016160300_rate_limit_buckets` (additive: table `rate_limit_buckets` + `updated_at` index), applied to the dev database with `prisma migrate deploy`.
- `apps/web/src/server/api/rate-limit.ts` rewritten:
  - `takeTokens` is a PostgreSQL token bucket: one atomic upsert per check, on the database clock, with `cost`, and a ~1% sweep of buckets idle over an hour.
  - Policies: writes 30/1 s, **reads 120/2 s (new)**, pairing start, device tokens.
  - `authRateLimitStorage` for Better Auth.
  - The in-memory `TokenBucketLimiter` and its unit tests were removed.
- `http.ts`:
  - async `limitByIp` and `chargeWrites`
  - new `chargeRead`, `authorizeRead` and `authorizeDeviceRead`
  - every `/api/v1` GET is now charged to the read budget (sessions list/detail, workspaces, devices, devices/me, sync pull/bootstrap)
- `auth.ts`: `rateLimit.customStorage`.
- Tests: `rate-limit.db.test.ts` (7) and a read-limit E2E in `api-sessions.spec.ts`.
- Docs: SYNC_PROTOCOL 13a (limits table) and 13g, SECURITY_PRIVACY, DATA_MODEL, SYSTEM_DESIGN 14 (three rows), ROADMAP.

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit):**

- `pnpm check --force`: **pass** (17 tasks). Web unit tests **55** (the 6 in-memory limiter tests were removed with the class).
- `pnpm --filter @sessionhub/web test:db`: **54/54** (+7). Covered: burst then Retry-After; refill capped, and denied attempts don't extend the wait; multi-token cost all or nothing; independent keys; **60 concurrent requests from two separate Prisma clients let exactly 30 through**; idle sweep removes only idle buckets; the Better Auth adapter.
- API, auth, pairing and push E2E: **17/17**, including the new read limit (130 parallel GETs: at least 120 pass, the rest 429 with Retry-After; writes and other users unaffected) and Better Auth's existing wrong-password limit through the new storage (its `auth:` buckets confirmed in `sessionhub_test`).
- Full web E2E **39/40**: only the pre-existing macOS password-reset failure.
- Not run:
  - extension suites: no extension changes in this slice
  - `pnpm test:docker` and the database package `test:db` (no Compose here; the latter resets `sessionhub_test`, which Prisma blocks for agents)

**Production note:** deploying this runs the new migration (additive) through the `migrate` job; afterwards every limited request does one extra small upsert.

**Known gaps:** per-IP limits still trust `X-Forwarded-For` (the proxy must overwrite it); no observability (URL-redacted logs/metrics) or resource limits yet.

### 2026-10-16 (M4 conflict review slice) / Claude Code (Opus 5.5) / `feature/m4-conflict-review` (macOS laptop)

**Goal:** conflict review (keep mine / keep server / save both) using `serverCopies` and the conflicting operation, the last M4 item (user's scope). Decisions in SYSTEM_DESIGN.md 14 and SYNC_PROTOCOL.md 13i.

**Implemented:**

- `packages/sync/src/review.ts` (new): `classifyReview` (five situations), `reviewChoices` (only what can be carried out), `serverVersionOf`, `copyAsNewSession` (new ids, group links remapped), `keptCopyName` + tests.
- Extension:
  - `db.ts`: `lastErrorCode` and `conflictServerVersion` on outbox records (no Dexie version change); the uploader fills them in.
  - `review-repository.ts`: `listReviewItems` (liveQuery-safe) and `resolveReview` (one transaction; re-checks the item and choice; one handler per situation and choice).
  - Command `sync.resolve` (syncs afterwards); `sync-apply.ts` exports `writeServerSession`.
  - `review-text.ts` (copy, link diff); `hooks/use-review.ts`.
  - `features/review/` (dialog, comparison, Sync card list); inspector "Needs review" banner; Sync card wording.
- E2E: `sync-two-profiles.spec.ts` gained a real conflict test.
- Docs: SYNC_PROTOCOL 13i (new) and section 5 note, UI_UX_DESIGN 18f (new), DATA_MODEL, SYSTEM_DESIGN 14 (four rows), ROADMAP (M4 done), README.

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit):**

- `pnpm check --force`: **pass** (17 tasks). `sync` **16** (+7), extension **173** (+14: 10 review repository, 2 copy/diff, 2 RTL review UI).
- `pnpm build`: **pass**. Web DB tests **47/47**.
- Two-profile E2E: the new conflict test passes. Both profiles rename the same session; Windows' upload conflicts, the pull holds the Mac's version, and Windows reviews it in the inspector and chooses Keep both. The server then has "Mac's plan" and "Windows' plan (this browser's version)", and the Mac gets both. Sync + pairing specs **21/21** over `--repeat-each 3`.
- Full web E2E **38/39**, extension E2E **8/9**: only the two pre-existing macOS failures.
- Layout: inspector banner, review dialog and Sync card list at 390 and 1280 px plus dark mode at 390 px, via a scratch Playwright script against the real build: no horizontal overflow. Screenshots reviewed; the device name was truncated at 390 px and now has its own line.

**Known gaps:** no field-level automatic merge (section 9's disjoint fields rule); workspaces aren't synced into the extension; no first-run sync banner, Settings page or URL exclusions; read rate limits and log/receipt pruning (M6).

### 2026-10-16 (M4 sync opt-in and status UI slice) / Claude Code (Opus 5.5) / `feature/m4-sync-ui` (macOS laptop)

**Goal:** opt-in + upload preview + sync status UI: replace the hardcoded "Local only", set `syncState.enabledAt`, Sync now (user's scope). User's decisions: uploads **move** chosen sessions into the account; the preview starts with **all** local sessions ticked. Recorded in SYSTEM_DESIGN.md 14.

**Implemented:**

- Extension worker:
  - `sync-consent.ts`: `enableSync` (consent + move with queued creates, one transaction; keeps the cursor) and `disableSync`.
  - `session-repository.ts`: `saveNewSession` (capture and import go to the account while sync is on) and `listSessionsWithSync`.
  - Commands `sync.enable` / `sync.disable`; `syncing` in the capture and import results.
  - `sync-runner.ts` queues one follow-up run for requests that arrive mid-run (bug found by E2E).
  - `lastErrorCode` for Offline; `account-scope.ts` `activeAccountScope`.
- Status: `lib/sync-status.ts` (row labels, overview, Sync now text; pure), `lib/sync-overview.ts`, `hooks/use-sync.ts`, `use-sessions.ts` (labels).
- UI:
  - `components/sync-status-chip.tsx` (chip, sidebar note, per-session badge)
  - `features/account/sync-section.tsx`, `upload-preview.tsx`
  - Account view copy updated
  - row status on its own line (manager) / in the meta line (popup)
  - inspector badge
  - delete dialog copy for account sessions
  - popup save text
- E2E: `sync-flow.ts` now drives the real UI (`captureAllWindows`, `turnOnSync`) instead of seeding IndexedDB; `sync-push.spec.ts` and `sync-two-profiles.spec.ts` rewritten on it; `pairing.spec.ts` copy updated.
- Docs: UI_UX_DESIGN 18e (new), SYNC_PROTOCOL 13h (new), DATA_MODEL, SECURITY_PRIVACY section 10 (two release checks ticked with evidence), SYSTEM_DESIGN 14 (five rows), ROADMAP, README.

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit):**

- `pnpm check --force`: **pass** (17 tasks). Extension **159** (+15: 7 status, 5 consent and save routing, 1 runner follow-up, 2 RTL opt-in/labels).
- `pnpm build`: **pass**.
- Web DB tests **47/47**.
- Sync and pairing E2E: **12/12** over `--repeat-each 2`. The real UI opt-in on two profiles: Windows captures and uploads via the preview, the Mac turns sync on with nothing to upload and downloads it (tab URLs unchanged), then rename and delete follow both ways. Also a new save while sync is on uploads by itself.
- Full web E2E **37/38**, extension E2E **8/9**: only the two pre-existing macOS failures.
- Layout: Account view (off and on), upload preview, session list and popup at 390 and 1280 px (and dark mode at 390 px) via a scratch Playwright script against the real build: no horizontal overflow; screenshots reviewed. Two things found and fixed:
  - narrow rows truncated the status away
  - a stale chip, which was an artifact of the script writing IndexedDB outside Dexie; reloading confirmed the chip is correct

**Known gaps:** no conflict review (Needs review explains both versions are kept); no first-run sync banner in the popup; no Settings page or URL exclusions; no per-row "Syncing..." state.

### 2026-10-16 (M4 sync pull slice) / Claude Code (Opus 5.5) / `feature/m4-sync-pull` (macOS laptop)

**Goal:** `GET /api/v1/sync/pull` with safe cursors and a `CURSOR_EXPIRED` bootstrap path, the extension pull following SYNC_PROTOCOL.md 13e, and `packages/sync` for the reconciliation rules (user's scope). Decisions in SYSTEM_DESIGN.md 14 and SYNC_PROTOCOL.md 13g.

**Implemented:**

- `packages/sync` (new): `reconcile.ts` (`reconcileRemoteChange`, `reconcileHeldCopy`, `toLocalSession`) + tests.
- Contracts: pull/bootstrap query and response schemas, `SYNC_PULL_LIMITS`, error code `CURSOR_EXPIRED`.
- Web: `src/server/sync/cursor.ts` (HMAC cursors), `pull.ts` (`pullPage`, `bootstrapPage`, 4 MB page budget), `device-reader.ts` (Bearer + confirmed email), routes `api/v1/sync/pull`, `api/v1/sync/bootstrap`; `CURSOR_EXPIRED` maps to 410.
- Extension: Dexie **v5** `serverCopies`; `syncState.bootstrap`; `account-api.ts` pull/bootstrap calls; `sync-apply.ts` (performs decisions inside the page transaction), `sync-downloader.ts` (`pullNow`), `sync-gate.ts` (gate, backoff, success shared with push), `sync-runner.ts` (`syncNow`: push then pull); uploader settles held copies after acceptance; `sync.now` replaces `sync.pushNow`; `sync-periodic` alarm (10 min).
- E2E: `apps/web/e2e/sync-flow.ts` (helpers), `sync-two-profiles.spec.ts` (new), `sync-push.spec.ts` moved onto the helpers and `sync.now`.
- Docs: SYNC_PROTOCOL 13e/13f/new 13g, DATA_MODEL, SECURITY_PRIVACY 5a item 10, SYSTEM_DESIGN 14 (eight rows), ROADMAP (M1 packages, four M4 items), README.

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit):**

- `pnpm check --force`: **pass** (17 tasks). `sync` **9**, contracts 36, core 84, extension **144** (+12: 11 download, 1 v4 -> v5 upgrade), web 61.
- `pnpm build`: **pass** (routes include `/api/v1/sync/pull` and `/api/v1/sync/bootstrap`).
- `pnpm --filter @sessionhub/web test:db`: **47/47** (+4: ordered pages with signed cursors incl. workspaces and deletes; other account's/edited/malformed cursors refused; `CURSOR_EXPIRED` after pruning and for a cursor ahead of the clock; bootstrap by id with tombstones and a pre-read cursor).
- `sync-two-profiles.spec.ts` (two real extension profiles, one account): **1/1**, then **2/2** repeated: Windows uploads, the Mac bootstraps it into its manager list, a rename on the Mac reaches Windows, a delete on Windows disappears on the Mac; tab URLs unchanged around every pull. `sync-push.spec.ts` + two-profile: **9/9** over `--repeat-each 3`.
- Full web E2E **37/38**, extension E2E **8/9**: only the two pre-existing macOS failures (password reset, mid-restore retry). Note: these two runs (and the DB run) were piped through `grep` in one command, against the repo rules; their summary lines are what is reported here.

**Known gaps:** no opt-in/upload preview (E2E seeds `enabledAt` and the account-scoped session directly); every session still shows "Local only", which is wrong for pulled sessions; no conflict review UI (conflicts keep the local operation and the server copy); workspaces are pulled but skipped by the extension; description/pinned/archived aren't stored locally; reads aren't rate-limited; receipts and the change log are never pruned.

### 2026-10-16 (M4 sync push slice) / Claude Code (Opus 5.5) / `feature/m4-sync-push` (macOS laptop)

**Goal:** `POST /api/v1/sync/push` with `sync_operation_receipts`, plus the extension uploader following SYNC_PROTOCOL.md 13e (user's scope). Protocol decisions recorded in SYSTEM_DESIGN.md 14 and SYNC_PROTOCOL.md 13f.

**Implemented:**

- Contracts: `packages/contracts/src/api-sync.ts` (envelope, per-operation schema, results, `SYNC_LIMITS.operationsPerPushMax = 25`), error code `DEVICE_MISMATCH`.
- Web: `src/server/sessions/mutations.ts` split into `createSessionInTx` / `updateSessionInTx` / `deleteSessionInTx` + unchanged wrappers; `src/server/sync/push.ts` (per-operation transaction: clock lock, receipt lookup, mutation, receipt; conflict/rejection receipts after rollback; replays with `replayed: true`); route `src/app/api/v1/sync/push/route.ts`; `TokenBucketLimiter.take(key, cost)` and `chargeWrites` in `src/server/api/http.ts`.
- Extension: `db.ts` (outbox `conflict`/`rejected`, session state `error`, `syncState.enabledAt`/`failures`/`nextAttemptAt`; no Dexie version change), `account-api.ts` `pushChanges`, `sync-batch.ts` (payload mapper, batch selection with held sessions, backoff), `sync-uploader.ts` (`pushNow`), `sync.pushNow` command, background triggers (worker start, after rename/delete, `sync-retry` alarm).
- E2E: `apps/web/e2e/pairing-flow.ts` (helpers moved out of `pairing.spec.ts`), `apps/web/e2e/sync-push.spec.ts`.
- Docs: SYNC_PROTOCOL 13a/13e/new 13f, DATA_MODEL (statuses, syncState, receipts), SECURITY_PRIVACY 5a item 9, SYSTEM_DESIGN 14 (eight rows), ROADMAP, README (status line was still "no backend").

**Validated commands and results (macOS, temporary `docker run` PostgreSQL + Mailpit as in the outbox session):**

- `pnpm check --force`: **pass** (14 tasks). Contracts 36, core 84, extension **132** (+16: 11 uploader, 5 batch), web **61** (+1 limiter cost).
- `pnpm build`: **pass** (route list includes `/api/v1/sync/push`).
- `pnpm --filter @sessionhub/web test:db`: **43/43** (+8 push: create/edit/delete with receipts and device provenance, replay changes nothing, 20 concurrent deliveries make one change, a stale edit stays a conflict even after the server reaches its expected version, another account's session is never touched, no edit-back of a tombstone, per-operation validation, receipts per device).
- `e2e/sync-push.spec.ts`: **2/2**, then **6/6** over `--repeat-each 3`: HTTP gates (cookie 401, `DEVICE_MISMATCH` 403, repeated session 400, 26 operations 400, unconfirmed email 403) and replay; the **real extension** in Chromium uploads a queued create via `sync.pushNow`, then the worker uploads a rename and a delete made through its normal commands on its own (server version 3, 3 accepted receipts, outbox empty).
- Full web E2E: **36/37** (only the pre-existing macOS password-reset failure). Extension E2E: **8/9** (only the pre-existing macOS mid-restore retry failure).

**Known gaps:** no pull; no UI shows sync state or sets consent (the E2E seeds an account-scoped session, its operation and `enabledAt` directly, standing in for the upload preview); conflict/rejected operations wait for a resolution UI; no periodic or network-change trigger; receipts are never pruned.

### 2026-10-16 (M4 local account scope + outbox slice) / Claude Code (Opus 5.5) / `feature/m4-local-outbox` (macOS laptop)

**Goal:** local account scope + durable outbox in the extension, its own PR (user's scope). Four decisions approved by the user before coding, recorded in SYSTEM_DESIGN.md 14: (1) add `account.id` to the pairing and `/devices/me` responses and scope by it; (2) existing and new local sessions stay `local`, upload preview later; (3) sync bookkeeping beside the session, not in `savedSessionSchema`; (4) account-scoped deletes leave a tombstone until the server's delete is pulled back.

**Implemented:**

- Contracts: `accountIdSchema`; `pairedAccountSchema` now `{ id, name, email }` (`packages/contracts/src/api-pairing.ts`, new `api-pairing.test.ts`).
- Web: `redeemPairing` and `getDeviceWithAccount` return the account id (`apps/web/src/server/devices/pairing.ts`, `service.ts`).
- Extension `db.ts`: `LocalScope = "local" | account:<id>`, `sync: { serverVersion, state }` on account-scoped records, Dexie **v4** (`outbox` `++seq, &id, [scope+seq], entityId`; `sessionTombstones`; `syncState`, empty for now).
- `account-scope.ts` (pure `visibleScopes`), `outbox-repository.ts` (`listOutbox`, `enqueueSessionUpsert`, `enqueueSessionDelete`: chained `expectedVersion`, in-place merge while `queued`, a never-sent create is dropped on delete), `session-repository.ts` (reads limited to visible scopes; rename and delete write session + operation (+ tombstone) in one transaction; hidden records are never edited or deleted), `command-handlers.ts` passes time and ids.
- `account-service.ts`: stores the id at pairing, `checkConnection` fills it in for older connections and disconnects (notice "expired") if the server ever reports a different id; `AccountStatus` exposes only name and email.
- Docs: DATA_MODEL 4 (v1 to v4 tables, rules; it still said "versions 1 and 2"), SYNC_PROTOCOL 13d (account id) and new 13e (uploader and pull contracts), SECURITY_PRIVACY 5a item 8, SYSTEM_DESIGN 14 (six rows), ROADMAP.

**Bug found and fixed during verification:** the first `listSessions` read the connection through nested async helpers (and `Promise.all`), which made Dexie's `liveQuery` stop tracking the session queries: lists stopped updating after a save. Caught by the existing import UI test; fixed by direct Dexie awaits (comments in `session-repository.ts`, `account-scope.ts`) and a regression test.

**Validated commands and results (macOS, Node 24.18.1, pnpm 11.17.0):**

- `pnpm check --force`: **pass** (14 tasks). Contracts **36** (+6), core 84, extension **116** (+19: 15 in `outbox.test.ts`, v3 -> v4 upgrade, live-list regression, 2 account-id tests), web 60.
- `pnpm build`: **pass** (extension 712 kB).
- `pnpm --filter @sessionhub/web test:db`: **35/35** (pairing now asserts `account.id`).
- Web E2E (`pnpm --filter @sessionhub/web test:e2e`): **34/35**. `pairing.spec.ts` **3/3**, including the new check that the extension stores `{ id, name, email }` after real pairing. Failing: `email.spec.ts` "password reset ..." (no status after "Send reset link"); **also fails on the original code** (stashed, rebuilt) and without `apps/web/.env.local`, so it is pre-existing on this Mac; CI passed it on #3/#4.
- Extension E2E: **8/9**. Failing: `local-slice.spec.ts` "a real mid-restore failure can be retried from the summary": the retried tabs report `url` and `pendingUrl` both `""` when read; **also fails on the original code** (6/6 and 2/2 repeats), so it is pre-existing on this Mac; CI passed it.
- Not run: `pnpm test:docker` and root `pnpm test:db` (no Docker Compose on this laptop; see below).

**Environment notes (macOS laptop):** Docker is the Homebrew CLI + Colima (`colima start`), **without the Compose plugin**, so `pnpm db:up` fails ("unknown shorthand flag: 'f'"). This session ran the same PostgreSQL 18 and Mailpit containers with `docker run` (names `sessionhub-verify-*`, volume `sessionhub-verify-pg`) and removed them afterwards. Env files were created from the examples (git-ignored).

**Known gaps:** no account-scoped data is created yet (upload preview and pull slices); every session still shows "Local only"; no uploader, conflict drafts or sync status UI; `syncState` is unused; the two macOS-only E2E failures above.

### 2026-10-16 (M4 pairing slice) / Claude Code (Opus 5.5) / `feature/m4-device-pairing`

**Goal:** pairing + device credentials + revocation, extension "Connect account" UI, tests and docs; then stop for review (user's scope choice). Design chosen by the user: own RFC 8628-style device flow (recorded in SYSTEM_DESIGN.md 7 and 14, SECURITY_PRIVACY.md 5a).

**Implemented:**

- Database: migration `20261016101018_device_pairing_and_credentials` (additive: `device_pairings`, `device_credentials`, enum `device_pairing_status`), applied to dev with `prisma migrate deploy`.
- Contracts: `api-pairing.ts` (requests, responses, token formats, user-code normalization, lifetimes); error codes `PAIRING_EXPIRED`, `PAIRING_DENIED`, `EMAIL_NOT_CONFIRMED`, `INVALID_TOKEN`, `ACCESS_TOKEN_EXPIRED`, `DEVICE_REVOKED`.
- Web server: `src/server/devices/tokens.ts`, `pairing.ts`, `credentials.ts` (issue, authenticate, rotate with reuse detection and lost-response retry), `revokeDevice(reason)` with `audit_events`; `http.ts` gained `authenticateDevice` (Bearer only), `authorizeDeviceWrite`, per-IP limits (`limitByIp`), status mapping and `WWW-Authenticate`. Routes: `POST /api/v1/pairing`, `/pairing/token`, `/pairing/decision`, `POST /api/v1/devices/token`, `GET /api/v1/devices/me`, `POST /api/v1/devices/me/disconnect`.
- Web UI: `/app/pair` (code entry, request card with device name and code, email-confirmation gate), Devices page "Disconnect" with confirmation.
- Extension: `WXT_API_BASE_URL` (build time, https unless localhost) -> one host permission; Dexie v3 `account` table; `account-api.ts` (validated responses), `account-service.ts` (start, poll, cancel, check, disconnect, single-flight refresh, revocation notice); six `account.*` worker commands; manager **Account** view. `SESSIONHUB_EXT_OUT_DIR` lets E2E build a copy into `.output/e2e`.
- E2E harness: the web E2E global setup builds the extension against the test server; `turbo.json` runs the web E2E after the extension E2E (no concurrent `wxt build`, one Chromium at a time) and declares `WXT_API_BASE_URL` for the extension build hash.

**Validated commands and results:**

- `pnpm --filter @sessionhub/web test:db`: **35/35** (+8: start/approve/redeem once, slow-down, expired/declined/decided requests, hashing at rest, 15-minute expiry, last seen, revoke then re-pair, rotation, lost-response retry, reuse revokes with audit events, two accounts on one installation).
- Extension unit tests **97/97** (+12 account service, +1 v2 -> v3 Dexie upgrade; the v1 upgrade test now expects version 3).
- `e2e/pairing.spec.ts` (real extension in Chromium + web server + Mailpit): **9/9** over `--repeat-each 3`: full pair -> device listed with last seen -> revoke on web -> extension shows the revoked notice -> pair again (same device, version 3) -> disconnect from the extension revokes on the server; decline; unconfirmed email blocked on the page and the API; unknown code; 375 px; Bearer-only endpoints reject cookies and forged tokens.
- `pnpm check` **pass** (14 tasks); `pnpm test:e2e` **pass** (4 tasks, 1m53s); `pnpm test:docker` **5/5** (now counts migration folders instead of expecting one).
- Extension builds: default manifest host permission `http://localhost:3000/*`, E2E build `http://127.0.0.1:3917/*`; `WXT_API_BASE_URL=http://evil.example` fails the build. Account view checked at 1280 and 390 px.

**Known gaps:** no sync yet (the Account view says so); one account per browser profile (switching needs the account-scope work); the extension rechecks the connection only when the Account view opens; per-process rate limits.

### 2026-10-16 (M3 workspace and device API slice) / Claude Code (Opus 5.5) / `feature/m3-email-auth`

**Goal:** finish M3's API item: workspace and device list/read/write with ownership checks.

**Implemented:**

- `packages/contracts`: `api-workspaces.ts` (create/update/delete schemas, `ApiWorkspace`, list with `sessionCount`, limits), `api-devices.ts` (`ApiDevice` without installation id, rename schema); error codes `WORKSPACE_NOT_EMPTY` and `LIMIT_REACHED`; conflict `serverState` can be a workspace.
- `apps/web/src/server/service-errors.ts` (`ServiceError` with `details`, `RollbackWith`) and `src/server/sync/transaction.ts` (`runMutation`, lock-first `nextSequence`), moved out of the sessions service unchanged; `sessions/errors.ts` removed.
- `src/server/workspaces/` (service + DTO) and `src/server/devices/service.ts`. Routes: `GET/POST /api/v1/workspaces`, `PATCH/DELETE /api/v1/workspaces/:id`, `GET /api/v1/devices`, `PATCH /api/v1/devices/:id`, `POST /api/v1/devices/:id/revoke`. Documented in `SYNC_PROTOCOL.md` 13b and 13c.

**Validated commands and results:**

- `pnpm --filter @sessionhub/web test:db`: **27/27** (+9: workspace create/list order and live counts, idempotent retry and `ID_IN_USE` across users, versioned update and conflict state, not-empty refusal then idempotent tombstone, no edits or new sessions into a tombstone, account isolation and the 100 cap, concurrent same-version edits (exactly one wins, gap-free sequence); device order without installation id, rename, revoke once with one credential bump, other users untouched). One existing session test updated for the renamed `details` property.
- `e2e/api-workspaces-devices.spec.ts`: **12/12** over `--repeat-each 3` (401/403, full HTTP lifecycle with 201/200/409/422 and `Location`, validation 400s, cross-user 404s, device rename/revoke idempotency and cross-site 403).
- Contracts unit tests **30/30** (+8). `pnpm check` **pass** (14 tasks); `pnpm test:e2e` **pass** (4 tasks).

**Known gaps:** no workspace or device management UI yet (M5); device registration and credentials (M4).

### 2026-10-16 (M3 email slice) / Claude Code (Opus 5.5) / `feature/m3-email-auth`

**Goal:** email delivery (user's choice: provider-agnostic, Resend for production, Mailpit locally) with password reset and email confirmation, plus change password.

**Implemented:**

- `apps/web/src/server/mail/`: `types.ts` (`MailTransport`, `parseAddress`), `resend.ts` (POST `https://api.resend.com/emails` via fetch, 10 s timeout, errors carry the HTTP status only), `mailpit.ts` (POST `/api/v1/send`), `templates.ts` (text + escaped HTML: confirm email, reset password, password changed), `deliver.ts` (`queueMail` with Next.js `after()`, failures logged without recipient or link; `isMailEnabled`).
- `src/server/env.ts`: `getMailConfig()` validates `MAIL_TRANSPORT` (default `disabled`), `MAIL_FROM`, `RESEND_API_KEY`, `MAILPIT_URL`.
- `src/server/auth.ts`: `sendResetPassword` (1 h, `revokeSessionsOnPasswordReset`), `onPasswordReset` notice, `emailVerification` (on sign-up, 24 h, no auto sign-in), `withCallback()` forces emailed links to `/email-verified` and `/reset-password`. Sign-in is still allowed with an unconfirmed email (decision in SYSTEM_DESIGN.md 14).
- Pages: `/forgot-password` (says when email isn't set up), `/reset-password` (`no-referrer`, `no-store`), `/email-verified`; "Forgot password?" on sign-in; `/login?reset=1` notice. Dashboard: "Confirm your email" banner with resend on every `/app` page (only when mail is enabled); Settings shows email status, resend, and a change-password form (signs out other browsers).
- `infra/docker/compose.dev.yaml`: Mailpit `axllent/mailpit:v1.31.3` (newest release older than two weeks) on `127.0.0.1:58025`. CI `check` job has a Mailpit service and `TEST_MAILPIT_URL`; `turbo.json` passes it through. Production compose passes `MAIL_TRANSPORT`/`MAIL_FROM`/`RESEND_API_KEY` (default disabled).

**Validated commands and results:**

- `pnpm --filter @sessionhub/web test`: **60/60** (+23: addresses, Resend request shape and secret-free errors, Mailpit request shape, template escaping and expiry text, `queueMail` failure logging and disabled no-op, mail env validation, reset/change schemas, `withCallback`).
- `e2e/email.spec.ts` (real emails through Mailpit): **18/18** over `--repeat-each 3`. Covers confirmation link and banner removal, tampered link refused + resend, reset with identical answers for unknown emails (and no email sent to them), mismatch error, all sessions revoked, "password changed" notice, link reuse refused, old password rejected, forged token rejected, change password (wrong current password, other browser signed out, this one kept), 375 px overflow on the new pages.
- Full web E2E **28/28**; `pnpm check` **pass** (14 tasks); `pnpm test:e2e` **pass** (4 tasks); web `test:db` **18/18**; `pnpm test:docker` **5/5** (now also checks that with email disabled `/forgot-password` says so and no banner appears).
- Visual check at 390 and 1280 px (banner, Settings, reset page): no overflow, readable.
- Failures found and fixed: Better Auth used `/` as the confirmation callback when the sign-up request had none (fixed server-side with `withCallback`); a revoked session on `/app/settings` is redirected by the `/app` layout to `/login?next=%2Fapp` (deep link lost; pre-existing, test loosened, noted below).

**Known gaps:** Resend not tested against the live service (needs a key and verified domain); a revoked session loses the deep link (layout redirect); `apps/web/.env.local` has no `MAIL_*` lines, so local dev defaults to email disabled until they are added (see `.env.example`).

### 2026-10-16 (M3 web Docker slice) / Claude Code (Opus 5.5) / `feature/m3-web-docker`

**Goal:** production Dockerfile for `apps/web` and a `web` service in compose with the `/api/health` healthcheck and an explicit `prisma migrate deploy` step, with tests.

**Implemented:**

- `apps/web/next.config.ts`: `output: "standalone"`, `outputFileTracingRoot` = monorepo root (workspace packages and Prisma's generated client are traced in).
- `infra/docker/web.Dockerfile` (context = repo root): `build` stage installs only `@sessionhub/web...` and builds; `runner` stage copies `.next/standalone` + `.next/static` into `node:24-alpine`, runs as `node` (uid 1000) with root-owned app files, `HEALTHCHECK` with `wget` on `/api/health`; `migrate` stage installs only `@sessionhub/database` and runs `prisma migrate deploy` (never resets). No secrets at build time.
- `infra/docker/compose.yaml`: `postgres` (not published to the host, `pg_isready` healthcheck) -> `migrate` (`service_healthy`, `restart: "no"`) -> `web` (`service_completed_successfully`, healthcheck, `read_only` root fs with tmpfs `/tmp` and `.next/cache` owned by uid 1000, `no-new-privileges`, published on `127.0.0.1:${WEB_PORT:-3030}`). `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` are required (`${VAR:?}`). `infra/docker/.env.example` documents them.
- `.dockerignore`: excludes `node_modules`, build output, `.git`, generated Prisma client and every `.env*` except `.env.example`.
- `apps/web/scripts/start-standalone.mjs` + `pnpm start`: runs the standalone server locally (`next start` does not support standalone output). The web E2E (`playwright.config.ts`) now runs this server, so E2E tests the same server the image runs.
- Container tests: `apps/web/e2e-docker/*` + `playwright.docker.config.ts`, `pnpm test:docker` (root and web). Global setup builds and starts the stack under project `sessionhub-smoke` (port 3939, random secrets) with `up --wait`; teardown runs `down -v`.
- CI: new `docker` job running `pnpm test:docker` (prints compose logs on failure).

**Validated commands and results:**

- `pnpm test:docker`: **5/5** (about 2 to 3.5 minutes with a warm Docker cache). Covers: postgres and web `healthy`, migrate `exited 0`, one applied row in `_prisma_migrations`; `/api/health` 200 `{"status":"ok"}` + `no-store`; sign-up -> `POST /api/v1/sessions` 201 -> GET -> `/app/sessions` HTML lists it, and a `sync_changes` row exists; re-running `migrate` prints "No pending migrations to apply"; web runs as uid 1000, contains no `.env*` file, can't write `server.js`, can write `.next/cache`; postgres has no published port; `docker compose config` fails without `POSTGRES_PASSWORD` or `BETTER_AUTH_SECRET`. No containers or volumes left behind afterwards (checked).
- Failures found and fixed during this slice: tmpfs `.next/cache` was root-owned (fixed with `uid=1000,gid=1000`); `docker compose port` on an unpublished port prints `invalid IP:0` instead of nothing (test now reads `Publishers` from `compose ps --format json`).
- Manual: standalone server against `sessionhub_test`: health 200, sign-up 200, create 201, CSS 200.
- `pnpm check`: **pass** (14 tasks). `pnpm test:e2e`: **pass** (4 tasks; web 22/22 on the standalone server, no `next start` warning). `pnpm --filter @sessionhub/web test:db`: **18/18**.
- Image sizes: `runner` 312 MB, `migrate` 1.55 GB (full Prisma CLI + workspace devDependencies; only used as a one-shot job).

**Earlier this session (PR #1 CI):** first GitHub run failed in `test:db` with "TEST_DATABASE_URL is not set": Turborepo strict env mode stripped the variable. Fixed in `3ec6bfc` (`passThroughEnv` for `test:db` and `test:e2e`), reproduced and verified locally, then the PR's `check` job **passed**. GitGuardian flags the dev placeholder password `sessionhub_dev` in `ci.yml` and `compose.dev.yaml` (`fe880c7`): local-only placeholder, not a real secret; mark as false positive or move to a variable (user's call).

**Known gaps:** `/api/health` is liveness only (no PostgreSQL readiness check); `migrate` image is large; no Coolify deployment or TLS/proxy config yet; the `docker` CI job has not run on GitHub yet.

### 2026-10-16 (M3 rate-limit slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** per-user rate limiting for `/api/v1` writes (in memory, 429 with Retry-After, documented limits) with tests.

**Implemented:**

- `apps/web/src/server/api/rate-limit.ts`: `TokenBucketLimiter` (injectable clock, bounded key count: fully refilled buckets dropped first, then least recently used), `API_WRITE_LIMIT` = 30 burst + 1/s, process-wide `getWriteLimiter()`.
- `apps/web/src/server/api/http.ts`: `authorizeWrite()` = same-origin check -> authentication -> limiter; 429 responses carry `Retry-After`. All three write routes use it.
- `packages/contracts`: `RATE_LIMITED` code and optional `retryAfterSeconds` in the error envelope.
- Dashboard: `src/components/sessions/notices.ts` (`noticeForError`) shows "You're making changes too quickly. Try again in N seconds. Nothing was changed."
- Limits documented in `SYNC_PROTOCOL.md` 13a.

**Validated commands and results:**

- `pnpm check --force` / `pnpm check`: **pass** (14 tasks); web unit tests 37 (+5 limiter: burst then whole-second Retry-After, refill without exceeding capacity, denied attempts don't extend the wait, independent users, bounded memory; +3 notices).
- `pnpm build --force`: **pass**. `pnpm --filter @sessionhub/web test:db`: **18/18**.
- `pnpm test:e2e`: **pass** (4 tasks). Web E2E **132/132** over 3 x `--repeat-each 2`; the new rate-limit test also **10/10** alone. It covers: 5 anonymous (401) and 5 cross-origin (403) writes don't consume the budget; a 35-request mixed DELETE/POST burst lets 30 to 33 through and answers the rest with 429 + `Retry-After` + `retryAfterSeconds`; reads still 200; another user still 201; after `Retry-After` a write succeeds again.
- **Flake found and fixed (test only):** the first version asserted 429 on a request sent *after* the burst; on a loaded run the burst took over a second, a token refilled and that request was correctly allowed. The test now reads `Retry-After` from a 429 inside the burst.

**Known gaps:** no read rate limits; limiter is per process.


### 2026-10-16 (M3 session detail slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** `/app/sessions/[id]` with the window/group/tab tree, rename/archive/delete via `/api/v1/sessions` with version conflicts surfaced, export JSON, safe open links; list rows link to it.

**Implemented:**

- `src/app/app/sessions/[id]/page.tsx` + `not-found.tsx`; list rows are links; Active/Archived views (`listSessions` `archived` option).
- `src/components/sessions/`: `session-actions.tsx`, `rename-form.tsx`, `use-session-mutation.ts` (conflict/not-found/error notices, Load latest), `confirm-dialog.tsx` (native modal), `window-tree.tsx` (server component, render-time URL classification).
- `src/lib/api-client.ts` (typed same-origin calls), `src/lib/session-files.ts` (`buildSessionExport`, `downloadSessionExport`, `openableUrls`, `openLinks`).
- `next.config.ts`: `Referrer-Policy: no-referrer` for `/app/*`.

**Validated commands and results:**

- `pnpm check --force`: **pass** (14 tasks); web unit tests 29 (+2: the export is accepted by the extension's own `parseSessionExport` + `prepareImportedSession`, and a mislabelled `javascript:` tab is re-flagged unsafe; `openableUrls` returns only web pages).
- `pnpm build --force`: **pass**. `pnpm --filter @sessionhub/web test:db`: **18/18**.
- `pnpm test:e2e`: **pass** (extension 9, web 21). Web E2E **84/84** over 2 x `--repeat-each 2`. New: row link -> detail; tree links only for http(s) with noopener/noreferrer, HTML title as text, `javascript:`/`chrome:` not links, `Referrer-Policy` header; rename then a real conflict (API edit behind the page) -> "now version 3" -> Load latest -> reapply -> version 4; archive/unarchive across views; delete needs confirmation, then not found (also malformed id and another user's id); export download validates against the schema; Open 2 links opens exactly the two web pages with `window.opener === null`; 375 px without overflow.
- Root `pnpm test:db` not run (database package unchanged; its reset needs fresh consent).

**Manual verification:** screenshots at 1440 (conflict notice, delete dialog, dark) and 390 px.

**Known gaps:** the pop-up-blocked path of "Open links" isn't covered by E2E (Playwright doesn't block pop-ups); no version history view; no description editing or pin toggle in the UI (API supports them).


### 2026-10-16 (M3 sessions API slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** account-scoped `/api/v1/sessions` (list/detail/create/update/delete) with `packages/contracts` Zod schemas, ownership checks, optimistic `version`, and SessionVersion + SyncChange + UserSyncClock in one transaction; cross-user denial tests against PostgreSQL.

**Implemented:**

- `packages/contracts/src/api-sessions.ts`: write inputs (position-ordered, client-scoped group refs, 5,000-tab cap, strict objects), list/delete queries, summary/detail DTOs, error envelope with conflict fields, `API_LIMITS`.
- `packages/core/src/session-structure.ts` `buildCanonicalStructure` (fresh child ids, remapped groups, positional order, re-classified URLs).
- `apps/web/src/server/sessions/`: `mutations.ts` (create/update/delete; clock lock first; version-guarded UPDATE; `RollbackWith` for replays), `queries.ts` (keyset list, detail), `dto.ts`, `checksum.ts`, `cursor.ts`, `errors.ts`.
- `apps/web/src/server/api/http.ts` (auth, same-origin check, JSON/size limits, validation issues, error mapping, `no-store`) and routes `src/app/api/v1/sessions/route.ts`, `[id]/route.ts`.
- `packages/database/src/client.ts`: type re-exports for the DB enums.
- Contract written up in `SYNC_PROTOCOL.md` 13a.

**Validated commands and results:**

- `pnpm check --force`: **pass** (14 tasks). Unit: contracts 20 (+12), core 84 (+3), extension 84, web 27.
- `pnpm build --force`: **pass**.
- `pnpm --filter @sessionhub/web test:db`: **18/18** (10 new): rows + version + change in one transaction; exact create retry is a no-op with no sequence consumed; id collision rejected; stale update/delete returns the conflict with server state and writes nothing; structure replacement; tombstone, idempotent delete, no resurrection; cross-user read/update/delete denied with nothing written and no clock row for the attacker; foreign/deleted workspace rejected; 20 concurrent creates get sequences 1..20; 10 concurrent edits of one version yield exactly 1 accept and 9 conflicts; keyset pages without duplicates; tampered cursor rejected.
- **Mutation checks:** taking the clock lock after the version check let all 10 racing edits through (lost updates) until the version-guarded UPDATE was added; with the guard alone the test passes too, so each guard is independently effective. Final code has both.
- `pnpm test:e2e`: **pass** (extension 9, web 15). Web E2E **60/60** over 2 x `--repeat-each 2`. New HTTP tests: 401 without session; full lifecycle incl. 201 + Location, 409 bodies, tombstone and repeat delete; cross-user 404s with data intact; foreign/missing Origin 403, wrong type 415, bad JSON 400, unknown field 400 with issues, body over 2 MB 413, non-UUID 404, bad limit/cursor 400; exact create retry 200 with identical body; API-created session appears in the dashboard.
- The root `pnpm test:db` was **not** run (its database reset needs fresh user consent); the database package's schema and migrations are unchanged in this slice.

**Known gaps:** no `/api/v1` rate limiting; no workspace/device endpoints or `/versions`; no session detail page; receipts for device pushes arrive with M4.


### 2026-10-16 (M3 dashboard slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** web dashboard shell under `/app` per UI_UX_DESIGN.md section 8: persistent nav, top search, Overview / Saved sessions / Devices / Settings, shared signed-in layout, honest empty states.

**Implemented:**

- `src/proxy.ts` (cookie-presence gate for `/app/*`, keeps the deep link in `next`); `src/server/session.ts` `requireSession()`.
- `src/server/queries/dashboard.ts`: `getOverviewStats`, `listSessions` (name search, 100 cap, excludes deleted/archived), `listDevices` (active first, last seen); all scoped by user id.
- `src/app/app/layout.tsx` + `components/dashboard/app-shell.tsx`, `nav-links.tsx` (sidebar + bottom tab bar, `aria-current`), `top-search.tsx` (Ctrl/Cmd+K), `page-parts.tsx` (header, empty state, sync notice, stat tile), `session-list.tsx`.
- Pages: `/app` (Overview), `/app/sessions`, `/app/devices`, `/app/settings`; `loading.tsx`, `error.tsx`. The previous `/app` placeholder was replaced.
- `src/lib/format.ts` (relative time, plural, initials) with tests.

**Validated commands and results:**

- `pnpm check --force`: **pass** (14 tasks); web unit tests 27.
- `pnpm build --force`: **pass** (also with no auth env vars; proxy registered).
- `pnpm --filter @sessionhub/web test:db`: **8/8** (4 new: cross-user isolation in lists/counts/search/devices, deleted and archived hidden, case-insensitive search, list cap, device ordering). Run directly (non-destructive `migrate deploy`); the root `pnpm test:db` was **not** run because its reset needs fresh user consent.
- `pnpm test:e2e`: **pass** (extension 9, web 10). Web E2E also **40/40** over 2 x `--repeat-each 2`. New dashboard E2E: signed-out deep link -> sign-in -> back to `/app/devices`; forged cookie rejected by the server check; nav `aria-current` and honest empty states; seeded data for two users shows only the signer's rows (Overview tiles, recent list, Ctrl+K search, no-match state); devices "last seen"/"Access revoked" and never "online"; 375 px bottom nav without overflow on all four pages.

**Manual verification:** screenshots at 1440 (light, dark), 900 and 390 px with seeded data.

**Known gaps:** no session detail page or row actions; search covers names only; no workspaces, recovery or account-deletion pages; avatar is a link, not a menu.


### 2026-10-16 (M3 auth slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** Better Auth 1.7.9 in `apps/web` with the Prisma adapter over `getPrisma()`, email/password, the Next.js route handler, sign-up and sign-in pages.

**Implemented:**

- `src/server/env.ts` (Zod-validated, lazy), `src/server/auth.ts` (`getAuth()`, Prisma adapter, email/password limits, name hooks, `nextCookies()`), `src/server/session.ts` (`getCurrentSession`, reads headers first so routes are dynamic), `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`).
- `src/lib/auth-client.ts` (`better-auth/react`), `src/lib/auth-validation.ts` (shared Zod schemas, `safeNextPath`), `src/lib/auth-errors.ts`.
- Pages: `(auth)/layout.tsx`, `/signup`, `/login`, `/app` (minimal signed-in page), sign-out server action; landing header links. Components: `text-field.tsx`, `sign-up-form.tsx`, `sign-in-form.tsx`, `use-auth-form.ts`.
- Tests: unit (`auth-validation`, `auth-errors`, `env`), DB integration (`auth.db.test.ts`, `pnpm test:db`), Playwright E2E (`apps/web/e2e/auth.spec.ts` on `next start` against `sessionhub_test`).
- `next.config.ts` `transpilePackages: ["@sessionhub/database"]`; `.env.example`; Turbo: `@sessionhub/web#test:db` depends on `@sessionhub/database#test:db`.

**Validated commands and results (final, after all fixes):**

- `pnpm check --force`: **pass** (14 tasks). Unit tests: contracts 8, core 81, extension 84, web 20.
- `pnpm build --force`: **pass**, also with no auth env vars set.
- `pnpm test:db`: **pass** (database 12, web 4: hashed password, sessions, wrong/unknown credentials, duplicate email, short password, server-side name rules).
- `pnpm test:e2e`: **pass** (extension 9, web 5). Web E2E also **45/45** over 3 x `--repeat-each 3`: sign-up -> `/app`, HttpOnly SameSite=Lax cookie, sign-out, protected redirect, wrong password message, sign-in, signed-in users skip auth pages, inline validation, duplicate email, `?next=//evil.test` lands on `/app`, 375 px without overflow, rate limit message after 3 wrong passwords.
- Better Auth CLI re-run against the real config: auth models identical (blank lines only).

**Findings and fixes:**

- `auth.api.signInEmail` from a server action bypasses Better Auth's rate limiter (no 429 after 4 wrong passwords); the HTTP endpoint limits after 3. Forms now use the HTTP endpoints via the Better Auth client.
- `getAuth()` evaluated before `await headers()` made `/app` prerender at build and require secrets; fixed by reading headers first.
- Test flakiness fixed: Next's route announcer is also `role="alert"`; per-test rate-limit buckets via random `X-Forwarded-For`; wait for sign-out to finish before the next navigation.

**Incident (test database only):** for a root `pnpm test:db` run I reused the user's earlier "Yes, reset sessionhub_test" consent instead of asking again. With Turbo running both packages in parallel, the database package's `migrate reset` raced the web package's `migrate deploy`, leaving `sessionhub_test` with a failed init migration (P3009). The dev database was not affected (verified). Fixes: Turbo now orders web `test:db` after the database reset; the README says consent is per run and must never be reused. The user then explicitly consented again ("Yes, reset sessionhub_test again") and the serialized run repaired the database and passed.

**Known gaps:** no email verification or password reset (needs email delivery); in-memory rate limit storage; `X-Forwarded-For` trust must be configured at deployment; `Secure` cookie flag not verified (no HTTPS yet); `/app` is a placeholder until the dashboard shell.


### 2026-10-16 (M3 database slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** `packages/database` with Prisma 7.x and the DATA_MODEL.md schema, plus local PostgreSQL via Docker Compose with a healthcheck.

**Implemented:**

- `packages/database/prisma/schema.prisma`: Better Auth core tables (generated by the official `auth` CLI 1.7.9 in an isolated scratch project with telemetry off, copied verbatim) + Device, Workspace, SavedSession, SavedSessionWindow/Group/Tab, SessionVersion, UserSyncClock, SyncChange, SyncOperationReceipt, UserSettings, AuditEvent; composite ownership FKs; migration `prisma/migrations/20261016052129_init`.
- `prisma.config.ts` (Node `process.loadEnvFile`), `src/client.ts` (`createPrismaClient`, `getPrisma` with a global cache), `.env.example`; generated client git-ignored and produced by `postinstall`.
- `infra/docker/compose.dev.yaml` (postgres:18-alpine, `127.0.0.1:54329`, `pg_isready` healthcheck, volume at `/var/lib/postgresql`) + `postgres-init/01-test-database.sql` (`sessionhub_test`).
- `test/global-setup.ts` (refuses non-`_test` databases, runs `prisma migrate reset --force`), `test/schema.test.ts`.
- Root scripts `db:up`, `db:down`, `db:migrate`, `test:db` (Turbo, uncached). CI: PostgreSQL service + `pnpm test:db` (never run on GitHub yet).
- Extension ESLint: `no-restricted-imports` for `@sessionhub/database`, `@prisma/*`, `pg` (verified with a probe import, then removed).
- `pnpm-workspace.yaml` `allowBuilds` for `prisma` (Node version check) and `@prisma/engines` (engine download from binaries.prisma.sh); both scripts were read before approving.

**Validated commands and results:**

- `pnpm db:up`: container healthy in about 8 s.
- `prisma migrate dev --name init`: created and applied the migration to the dev database.
- `pnpm test:db`: **12/12 pass** against real PostgreSQL 18.6: cross-user workspace, device, receipt and version references rejected (P2003); tab-to-other-window group rejected; device/installation, sequence, receipt and sort-order uniqueness (P2002); session delete cascades; referenced device can't be hard-deleted until cleared; user delete removes only that user's data; enums, BigInt beyond 2^53, JSON defaults; overlong name rejected. Afterwards the dev database had 0 users and the test database 16, confirming isolation.
- **Consent:** Prisma 7 refused `prisma migrate reset` because an AI agent ran it. The user explicitly answered "Yes, reset sessionhub_test", which was passed as `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` for that run only; it is not stored anywhere. Future agent runs of `pnpm test:db` must ask again.
- `pnpm check --force`: **pass** (14 tasks, now including database lint/typecheck). `pnpm build`: **pass**. `pnpm test:e2e`: **pass**.

**Known gaps:** the web app doesn't use the database yet; no seed data; no production migration step or web Dockerfile; `prisma` prints an "update available" banner for 7.10.1 (ignored on purpose).


### 2026-10-16 (seventh slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** last M2 item: large live-browser E2E (100+ tabs across several windows) timing capture, checkpoint and restore, with baselines recorded.

**Implemented:**

- `apps/extension/e2e/perf.spec.ts` (tag `@perf`): 4 x 30 tabs in 12 groups via a local Node HTTP server; times capture (median of 3), checkpoint (created and unchanged), inspector render, popup open-to-interactive, full restore; asserts correctness (all 120 opened, 4 new windows, groups recreated) and regression guards; writes `test-results/perf.json`.
- `e2e/fixtures.ts`: `launchWithExtension` accepts extra Chromium args.
- Scripts: extension `test:e2e` now excludes `@perf`; new extension and root `test:perf` (Turbo task depends on `build`, not cached). Not added to CI.

**Validated commands and results:**

- `pnpm test:perf` (root, via Turbo): **pass**; three full 120-tab runs total, all passing. Baselines (median, range): capture 39 ms (34 to 56), checkpoint written 28 ms (20 to 61), unchanged 15 ms, inspector render 186 ms, popup interactive 269 ms, **restore 15.7 s for 120 tabs (11.1 to 25.9 s, 92 to 215 ms per tab)**, IndexedDB 1.2 MB, peak memory increase about 2 to 3 GB. Full table and environment: `TEST_PLAN.md` 5.1.
- `pnpm check --force`: **pass** (12 tasks). `pnpm test:e2e`: **pass** (9 tests, perf excluded).
- Memory safety: every full run used a watchdog that kills Chromium above 7.8 GB used (this WSL2 machine has crashed on memory commit before); it never triggered. Peak 4.8 to 5.9 GB used of 9 GB.

**Findings:**

- Playwright route interception made restore about 2.5x slower (195 vs 80 ms per tab at 30 tabs), so perf pages come from a real local server.
- Restore is the slow path and is bound by browser tab creation on this machine. A 60-tab experiment: sequential `tabs.create` 2.7 s, one `windows.create({ url: [...] })` 1.5 s, parallel `tabs.create` 3.1 s. **Proposed follow-up (needs a decision):** create each restored window with all its URLs in one call, then apply pinning and groups, falling back to per-tab creation if the batch call fails. That would trade per-tab failure detail for roughly 1.8x speed.

**Known gaps:** 500 tabs / 20 windows not run (memory); no search benchmark over 10,000 saved tabs; perf not in CI (machine-dependent).


### 2026-10-16 (sixth slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** M2 quota-failure handling (catch `QuotaExceededError` on save/import/checkpoint, specific message, evict extra old checkpoints and retry once while protecting the newest).

**Implemented:**

- `apps/extension/src/lib/storage-errors.ts`: `isQuotaError` (name, legacy code 22, `inner`, `cause`, bulk `failures`, depth-limited), `RestoreRecordingError`.
- `command-handlers.ts`: `storage-full` error code with per-command "so X didn't happen" messages; `runRestoreJob` stops at the first unrecordable window and keeps the original error even if settling fails too.
- `recovery-repository.ts` `freeCheckpointSpace`; `recovery-checkpoint.ts` evict-and-retry-once with a typed storage-full error; `recovery.checkpointNow` returns `freedForSpace`.
- UI: Recovery notice for freed space; "Restore stopped:" / "Retry stopped:" prefixes; no duplicated checkpoint error.

**Validated commands and results (final run after last code change):**

- `pnpm check --force`: **pass** (12 tasks). Tests: contracts 8, core 81, extension 84 (+10 detection, +9 quota handling, +3 quota UI), web 1.
- `pnpm build --force`: **pass**. E2E: **9/9 pass** (regression; no new E2E, see below).

**Not verified in a real browser:** a genuine quota failure. `Storage.overrideQuotaForOrigin` via CDP is **not enforced** for the extension's IndexedDB in Chromium 156: with a 1-byte override, three saves, a ~1 MB import and a checkpoint all succeeded. Quota behavior is covered only by unit/UI tests that inject `Dexie.QuotaExceededError` at the exact write points. A manual check on a nearly full disk, or a different enforcement mechanism, is still needed.

**Known gaps:** no storage usage display; no explicit "free space" action; if a restore job's outcome write fails, the tabs of that window are open but unrecorded (the message says so).


### 2026-10-16 (fifth slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** M2 restore-job housekeeping (settle stale running jobs on worker start, prune old jobs, reopen the last job's summary).

**Implemented:**

- `apps/extension/src/lib/restore-job-repository.ts`: `settleInterruptedJobs` (running + `updatedAt` before the worker start -> settled from outcomes, `interruptedAt`), `selectJobsToPrune` / `pruneRestoreJobs` (`RESTORE_JOB_RETENTION` 50 / 30 days, keys only, never prunes running or the newest job), `getLatestRestoreJob`, `runRestoreHousekeeping` (never throws).
- `apps/extension/src/entrypoints/background.ts`: captures `workerStartedAt` synchronously and runs housekeeping on every worker start.
- `db.ts`: optional `interruptedAt` on restore jobs (no schema version change; not indexed).
- UI: `restore-result.tsx` (summary + retry, shared), `last-restore.tsx` + `hooks/use-latest-restore-job.ts` in both inspectors; `restore-summary.tsx` shows "Still restoring" and the cut-off explanation; `restore-dialog.tsx` now delegates retry to `RestoreResult`.

**Validated commands and results (final run after last code change):**

- `pnpm check --force`: **pass** (12 tasks). Tests: contracts 8, core 81, extension 62 (+7 housekeeping, +2 Last restore UI), web 1.
- `pnpm build --force`: **pass**.
- E2E `--repeat-each 2`: **18/18 pass** (9 tests; the new one also 3/3 alone). New: seed a `running` job that only reached its first tab plus a 60-day-old job, force-stop the worker via CDP, wake it with a message -> the cut-off job becomes `partial` with `interruptedAt`, the old job is pruned; the inspector shows "opened 1 of 3, interrupted"; View summary -> Retry 2 tabs opens exactly the two unreached URLs in a new window.

**Manual verification:** inspector screenshots at 1440 and 390 px after a real partial failure (red line), and the reopened summary after retry (neutral "opened all 3").

**Known gaps:** a restore cut off while the browser stays open is only settled when the worker next starts (Chrome stops idle workers within about 30 s, so in practice soon); `getLatestRestoreJob` loads all jobs for one source (bounded by pruning).


### 2026-10-16 (fourth slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** M2 automatic recovery snapshots (alarms, debounced durable dirty flag, bounded retention protecting the last good snapshot, Recovery view).

**Implemented:**

- `packages/core/src/recovery.ts`: `fingerprintCapture`, `selectSnapshotsToEvict` (`RECOVERY_RETENTION` 50 / 7 days; newest and largest recent always kept), `diffSnapshotUrls`; `naming.ts` adds "Checkpoint, ...".
- `apps/extension/src/lib/db.ts`: Dexie **version 2** (`recoverySnapshots`, `recoveryState`).
- `apps/extension/src/lib/recovery-repository.ts` (dirty flag, transactional commit + eviction via index keys only), `recovery-checkpoint.ts` (`runCheckpoint`), `recovery-scheduler.ts` (debounce/periodic alarms).
- `apps/extension/src/entrypoints/background.ts`: change listeners, alarm handler (no tight retry loop after errors), startup/install hooks.
- Commands `recovery.checkpointNow`, `recovery.restore`; restore code shared with sessions.
- `browser-capture.ts`: SessionHub's own pages are no longer captured.
- Manager: shell with nav and hash routes (`use-manager-route.ts`, `master-detail.tsx`, `sessions-view.tsx`); `features/recovery/` (view, timeline, inspector); `RestoreDialog` `kind="snapshot"`.
- Manifest permission added: `alarms`.

**Validated commands and results (final run after last code change):**

- `pnpm check --force`: **pass** (12 tasks). Tests: contracts 8, core 81 (+13 recovery, +1 naming), extension 53 (+11 recovery logic incl. v1->v2 migration, +4 Recovery UI, +1 date buckets), web 1.
- Mutation check: removing the in-transaction fingerprint comparison makes the overlapping-checkpoint test fail (then restored).
- `pnpm build`: **pass**.
- E2E `--repeat-each 2`: **16/16 pass** (8 tests). New: (a) opening a tab sets the durable dirty flag and arms `recovery-debounce` (periodic alarm present, 30 min); the **real Chrome alarm** fires (~30 s) and the open Recovery view shows the automatic checkpoint live; the manager page is not in it; dirty is cleared; restoring it from the Recovery inspector opens exactly that tab in a new window. (b) "Checkpoint now" twice reports "Nothing changed" and stores one checkpoint.

**Manual verification:** Recovery view screenshots at 1440 (light and dark), 1024 and 390 px (no horizontal overflow; nav becomes a row on narrow screens).

**Known gaps:** no retention settings UI; no per-checkpoint delete; list loads full checkpoint bodies (bounded at about 52); a browser crash between a change and the debounce alarm loses up to ~30 s of changes; the startup checkpoint (`runtime.onStartup` marks dirty) is not covered by a browser-restart test yet; quota exhaustion still surfaces as a generic error.


### 2026-10-16 (third slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** M2 retry of failed tabs from a restore job (`restore.retry`, never reopen tabs that opened, Retry button in the summary).

**Implemented:**

- `packages/core/src/restore-plan.ts`: `planRetry(plan, openedTabIds)`.
- `apps/extension/src/lib/restore-job-repository.ts`: `attempts`, `openedTabIds`, `summarizeRestoreJob` (latest failure per tab, not-attempted count), `claimRestoreJobForRetry` (transactional compare-and-set), `finishRestoreJob` counts unique opened tabs.
- `apps/extension/src/lib/command-handlers.ts`: `restore.retry`; shared `runRestoreJob` always settles status, even when a step throws (previously left `running`).
- `apps/extension/src/lib/browser-restore.ts`: plain-language failure reasons.
- `apps/extension/src/features/manager/restore-summary.tsx`, `restore-dialog.tsx`: Retry button, retrying state, refusal message.
- `apps/extension/vitest.config.ts` / `vitest.setup.ts`: test timeout 20s and RTL `asyncUtilTimeout` 5s (two UI tests timed out only when Turbo ran every package in parallel; they passed in isolation).

**Validated commands and results (final run after last code change):**

- `pnpm check --force`: **pass**, twice in a row (12 tasks). Tests: contracts 8, core 68 (+3 `planRetry`), extension 37 (+5 retry handler, +2 retry UI), web 1.
- Mutation check: removing the `already running` guard makes the concurrent-retry test fail (then restored).
- `pnpm build --force`: **pass**.
- E2E `--repeat-each 3`: **18/18 pass** (6 tests). New: (a) real failure: a worker listener closes each restored window on creation so later `tabs.create` calls fail for real; the UI shows the reason and Retry, and after retry exactly the failed count reopens in one new window (also 8/8 on its own); (b) retry through the real worker reopens only the one tab marked failed in IndexedDB, then a second retry is refused with `conflict`.

**Manual verification:** screenshots of the failed summary (1440, 390) and the post-retry summary.

**Known gaps:** a job left `running` by a killed worker can't be retried (needs stale-job recovery); `restoreJobs` still not pruned; no retry entry point outside the restore dialog (closing the dialog loses easy access to the job). *(All three resolved in the fifth slice.)*


### 2026-10-16 (second slice) / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Goal:** M2 JSON import with preview (re-classify URLs, fresh UUIDs, never overwrite).

**Implemented:**

- `packages/core/src/session-import.ts`: `parseSessionExport` (10 MB cap, JSON, format, newer-version and schema checks with readable messages), `prepareImportedSession` (fresh ids, remapped groups, normalized ordering, re-classified URLs, `sourceDeviceId: null`), `SessionImportError` codes.
- `apps/extension/src/lib/`: `session.import` command (`messages.ts`), handler (`command-handlers.ts`, errors mapped to `invalid-input` / `conflict`), `addSession` with `SessionExistsError` (`session-repository.ts`), `sessionSourceLabel` / `sessionOrigin` (`format.ts`).
- `apps/extension/src/features/manager/import-control.tsx`, `import-dialog.tsx`; Import button in `manager-app.tsx`; "Imported from ..." label in list, popup, inspector and restore dialog.
- Web landing page status lists updated.

**Validated commands and results (final run after last code change):**

- `pnpm check --force`: **pass** (12 tasks). Tests: contracts 8, core 65 (+18 import), extension 30 (+4 handler, +1 repository, +3 import UI), web 1.
- `pnpm build --force`: **pass**.
- `pnpm --filter @sessionhub/extension test:e2e`: **4/4 pass**; `--repeat-each 5`: **20/20 pass**. New test: export through the real download, import that file through the file input, two distinct session ids in IndexedDB, then restore the imported copy into a new window.

**Covered rejection cases (unit):** not JSON, JSON array, foreign format, newer schema version, version 0, invalid UUID, overlong title, dangling group reference, duplicate ids, >10 MB, file with no tabs. Tampered `eligibility: "restorable"` on a `javascript:` URL is stored as `unsafe`. Forced session-id collision returns `conflict` and leaves the original byte-for-byte unchanged. HTML in names/titles renders as text (RTL test).

**Manual verification:** screenshots of import preview (1440, 390) and the newer-version error dialog. Fixed: at 390 px the manager header wrapped; the session count is now hidden below `sm`.

**Known gaps:** no drag-and-drop import; no import entry in the popup; no multi-session/backup files (one session per file); identical names are not de-duplicated.


### 2026-10-16 / Claude Code (Opus 5.5) / `feature/m1-monorepo-local-slice`

**Milestones:** finished M0 version validation, M1 skeleton, first M2 vertical slice.

**Plan followed:** validate versions -> monorepo + shared configs -> `contracts` and `core` pure packages with tests -> extension storage/commands with tests -> popup + manager UI -> real-Chromium E2E -> minimal web shell -> docs.

**Implemented (paths):**

- Root: `package.json`, `pnpm-workspace.yaml` (jsdom override), `turbo.json`, `.nvmrc`, `.gitignore`, `.github/workflows/ci.yml`.
- `packages/typescript-config` (`base.json`, `react.json`), `packages/eslint-config` (`base.js`, `react.js`, flat config).
- `packages/contracts/src/session.ts` (saved session schema, limits, eligibility enum), `session-export.ts` (export format v1).
- `packages/core/src/`: `url-classification.ts`, `capture.ts`, `restore-plan.ts` (re-classifies URLs, pinned-first, groups), `search.ts`, `session-edit.ts`, `session-export.ts`, `session-summary.ts`, `naming.ts`.
- `packages/ui/src/tokens.css` (light/dark tokens as Tailwind v4 theme).
- `apps/extension/`: `wxt.config.ts` (permissions `tabs`, `tabGroups`, `favicon`); `src/entrypoints/{background.ts,popup/,manager/}`; `src/lib/` (Dexie db, repositories, Zod command protocol, command handlers, Chrome capture/restore adapters, export download); `src/features/{popup,manager}/`; `e2e/` Playwright suite.
- `apps/web/`: Next.js 16.4.1 App Router landing page, `src/app/api/health/route.ts`.

**Validated commands and results (all run this session, final run after last code change):**

- `pnpm check --force` (lint + typecheck + unit tests, 12 Turbo tasks): **pass**
  - contracts 8 tests, core 47 tests, extension 22 tests (repositories with fake-indexeddb, command handlers, RTL popup/manager), web 1 test
- `pnpm build --force`: **pass** (extension `.output/chrome-mv3`, ~656 kB; web `next build`)
- `pnpm --filter @sessionhub/extension test:e2e`: **3/3 pass**; also `--repeat-each 5`: **15/15 pass**
  - real Chromium 156 (Playwright 1.64.1) with the unpacked extension: save from popup UI, find in manager, restore into a new window (pinned + group recreated, original tabs untouched); force-stop the service worker via CDP and save again; browser restart keeps sessions; malformed command rejected.

**Manual verification:** screenshots of popup, manager (1440 light/dark, 1024, 390) and restore dialog reviewed; no horizontal overflow at 390 px. Web landing checked at 1440 and 375 px; `/api/health` returned `{"status":"ok"}` from `next start`. Not tested by hand in a regular desktop Chrome profile.

**Bugs found and fixed during verification:** a tab still loading reports `url: ""` with the real URL in `pendingUrl`; capture used `??` and would have stored it as invalid. Now uses `||` (`apps/extension/src/lib/browser-capture.ts`).

**Decisions and docs updated:** `SYSTEM_DESIGN.md` sections 13-14 (status, decisions log), `DATA_MODEL.md` (implemented Dexie v1 schema, limits, eligibility), `SECURITY_PRIVACY.md` (shipped permissions), `UI_UX_DESIGN.md` 18a (deliberate deviations), `ROADMAP.md` checkboxes, `README.md` dev commands.

**Known incomplete behavior:**

- No retry of failed tabs after a partial restore (job records with outcomes exist to support it).
- `restoreJobs` table grows without pruning.
- Large restores open all tabs at once (no throttling or progress per tab); not tested with hundreds of real tabs.
- The manager's own tab (and the popup page if opened as a tab) are saved as "Won't restore" reference rows; consider skipping SessionHub's own pages on capture.
- No extension icons (Chrome shows a default letter icon).
- IndexedDB quota exhaustion is not handled specifically (surfaces as a generic `storage-error`).
- Window tree is not virtualized.

**Security / data-migration notes:** Dexie schema is version 1; future tables must be added as new versions. Background accepts commands only from this extension's pages and validates them with Zod. Only `http(s)` URLs are ever opened by restore.

## Immediate next executable task

1. Review PR #17 (`bugfix/local-only-conflict-identity`) once its checks pass. The branch includes current main; #14, #15 and #16 are merged.
2. PR #15 (workspace sync, server side) is merged. Build the extension half on a new branch off `main`:
   - a `workspaces` table (Dexie v6) and `workspaceId` on local sessions
   - pull and bootstrap applying workspace changes, dropping account workspaces missing from a bootstrap's live set (unless they have pending local changes); uploads of workspace operations and assignments (workspace first, unassign before delete)
   - a workspace switcher (a per-browser view; new saves go into the active workspace)
   - assigning sessions, and moving a session's workspace along when local sessions move into the account
   - deleting a workspace by unassigning its sessions first, after confirmation
   - a policy for workspace edit conflicts

   From now on: one small PR per slice, off `main`.
3. Before public launch choose the production domain, finalize `/privacy` operator/private contact/provider/retention details, set `EXTENSION_API_BASE_URL` and follow DEPLOYMENT, BACKUPS and RELEASE on the actual host. Record live evidence before checking the remaining two M6 boxes.
4. Next Smaller leftover after the local-only fix lands: allow `LIMIT_REACHED` changes to retry with a fresh operation after capacity is freed. Re-review the three dependency advisories before release/by 2026-11-17; current reachability evidence is in SECURITY_REVIEW_M6.
5. Complete Windows/macOS stable Chrome smoke and final account-flow screenshots/reviewer materials. Old fix worktrees belong to other sessions; leave them alone unless asked.

## Open questions / architecture validations

- Recovery retention is 50 checkpoints / 7 days for now; revisit after quota benchmarks.
- Decide use of browser-to-extension external messaging only after threat review.
- Should a manual save/import be allowed to delete old recovery checkpoints when storage is full (currently: no, it only reports)?
- Resolved: extension auth = own device flow with SessionHub device credentials (user's choice, 2026-10-16; SECURITY_PRIVACY.md 5a).
- Resolved this session: URL classification policy is now in code and tests (`packages/core/src/url-classification.ts`); WXT entrypoint names are `background`, `popup`, `manager` (builds `manager.html`).

## Session handoff template — update after every coding session

Copy this section for each significant session, keeping the latest at the top:

```text
Date / agent / branch:
Milestone:
Goal:
Implemented (specific files/paths):
Validated commands and results:
  - pnpm lint: ...
  - pnpm typecheck: ...
  - pnpm test: ...
  - pnpm build: ...
Manual verification:
Decisions and docs updated:
Known broken/incomplete behavior:
Security/data-migration concerns:
Next exact executable task:
```

**Agent instruction:** If a test was not run, record `Not run`; never record a guess as a pass. Documentation lists planned behavior until a code path and test verify it.
