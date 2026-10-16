# SessionHub — Persistent Implementation Handoff

> **This is the first file a returning coding agent should read.**  
> **Last updated:** 2026-10-16
> **Current milestone:** M2 (local extension MVP) in progress. M0 version validation and M1 skeleton are done.

## Current truth (verified 2026-10-16)

| Area | State |
|---|---|
| Monorepo | **Working.** pnpm 11 workspaces + Turborepo 2.11; `pnpm check`, `pnpm build`, `pnpm test:e2e` pass |
| Chrome extension | **Working local slice.** Save current/all windows (tabs, pinned, groups) to IndexedDB; popup recent list + search; manager list/search/inspector; rename (version-checked); delete (confirmed); export JSON; **import JSON with preview**; restore preview -> new windows -> per-tab summary -> **retry failed tabs**; **automatic recovery checkpoints** with a Recovery view |
| Side panel, workspaces, settings | Not implemented |
| Web app | Static landing page + `GET /api/health` only. No auth, DB or dashboard |
| Database / auth / sync | Not implemented (`packages/database`, `packages/sync` intentionally not created yet) |
| CI | `.github/workflows/ci.yml` written; **never run on GitHub** (no remote configured) |
| Git | Branch `feature/m1-monorepo-local-slice`: `e491fc9` skeleton + local slice, `7f0287a` import, `11520cf` retry. The recovery slice is **not committed yet** |

Dependency versions and their rationale: `docs/SYSTEM_DESIGN.md` section 14.

## Session log

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

**Known gaps:** a job left `running` by a killed worker can't be retried (needs stale-job recovery); `restoreJobs` still not pruned; no retry entry point outside the restore dialog (closing the dialog loses easy access to the job).


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

1. Commit the recovery slice (needs the user's go-ahead); push a remote so CI runs for the first time.
2. Finish M2:
   1. Restore-job housekeeping: settle stale `running` jobs on worker start (older than a few minutes, from recorded outcomes), prune old jobs, reopen the last job's summary.
   2. Quota-failure handling: catch `QuotaExceededError` on save/import/checkpoint, show a specific message, and for checkpoints evict extra old snapshots and retry once while still protecting the newest.
   3. Large live-browser test (100+ tabs) for capture, checkpoint and restore timing; record numbers.
3. Then M3 (PostgreSQL, Prisma 7.x stable, Better Auth).

## Open questions / architecture validations

- Confirm extension auth implementation that satisfies current Better Auth and Chrome policies.
- Recovery retention is 50 checkpoints / 7 days for now; revisit after quota benchmarks.
- Decide use of browser-to-extension external messaging only after threat review.
- Should capture skip SessionHub's own extension pages entirely?
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
