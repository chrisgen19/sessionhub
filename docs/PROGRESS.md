# SessionHub — Persistent Implementation Handoff

> **This is the first file a returning coding agent should read.**  
> **Last updated:** 2026-10-16
> **Current milestone:** M2 (local extension MVP) in progress. M0 version validation and M1 skeleton are done.

## Current truth (verified 2026-10-16)

| Area | State |
|---|---|
| Monorepo | **Working.** pnpm 11 workspaces + Turborepo 2.11; `pnpm check`, `pnpm build`, `pnpm test:e2e` pass |
| Chrome extension | **Working local slice.** Save current/all windows (tabs, pinned, groups) to IndexedDB; popup recent list + search; manager list/search/inspector; rename (version-checked); delete (confirmed); export JSON; restore preview -> new windows -> per-tab summary |
| Recovery snapshots, import, side panel, workspaces | Not implemented |
| Web app | Static landing page + `GET /api/health` only. No auth, DB or dashboard |
| Database / auth / sync | Not implemented (`packages/database`, `packages/sync` intentionally not created yet) |
| CI | `.github/workflows/ci.yml` written; **never run on GitHub** (no remote configured) |
| Git | Repo initialized this session on branch `feature/m1-monorepo-local-slice`; **nothing committed yet** |

Dependency versions and their rationale: `docs/SYSTEM_DESIGN.md` section 14.

## Session log

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

1. **Commit this work** on `feature/m1-monorepo-local-slice` (not committed yet; needs the user's go-ahead) and push to a GitHub remote so CI runs for the first time.
2. Continue M2 in this order, each as a tested slice:
   1. **JSON import with preview**: parse with `sessionExportSchema`, re-classify URLs, assign fresh UUIDs, never overwrite an existing session; add a `session.import` command and an import entry in the manager.
   2. **Retry failed tabs** from a restore job (`restore.retry` command reading `restoreJobs` outcomes; never reopen successful tabs).
   3. **Automatic recovery snapshots**: `alarms` permission, debounced dirty flag in IndexedDB, bounded retention that never evicts the last good snapshot, Recovery view in the manager.
   4. Quota-failure handling and restore-job retention.
3. Then M3 (PostgreSQL, Prisma 7.x stable, Better Auth).

## Open questions / architecture validations

- Confirm extension auth implementation that satisfies current Better Auth and Chrome policies.
- Choose recovery snapshot default retention after quota benchmarks.
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
