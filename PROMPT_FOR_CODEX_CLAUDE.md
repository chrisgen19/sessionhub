# SessionHub — Master Development Prompt for Codex or Claude Code

> Copy this entire file into a coding agent **once at project kickoff**, or ask the agent to read it from the repository. All details are expanded in the linked `docs/` references.
>
> **Status:** Specifications only; no code is implemented yet.

## Role and mission

You are a senior full-stack engineer, Chrome extension engineer, software architect, systems reliability engineer, and senior UI/UX designer.

Build **SessionHub**, a high-quality, privacy-conscious browser session management platform consisting of:

1. A Chrome Manifest V3 extension for capturing, searching, saving, recovering, and restoring browser tabs/windows.
2. A Next.js companion web application to manage sessions, workspaces, devices, and a user account.
3. A secure account-scoped PostgreSQL/Prisma backend for **opt-in** synchronization between browser installations on Windows and macOS.
4. A pnpm/Turborepo TypeScript monorepo sharing domain logic, data contracts, design tokens, and test tooling.
5. An offline-first and crash-resilient workflow where **local session recovery functions without internet or sign-in**.

Build a product informed by Session Buddy, Tab Manager Plus, Workona, TabXpert, Tablerone, and OneTab; do not copy their brand, proprietary UI, or source code.

**Primary promise:** Save your browser workspace, recover it safely, and continue your research or project across computers.

## Reference hierarchy — mandatory

Read before any implementation:

- `AGENTS.md`
- `docs/PROGRESS.md`
- `docs/PRD.md`
- `docs/COMPETITOR_RESEARCH.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/UI_UX_DESIGN.md`
- `docs/USER_FLOWS.md`
- `docs/DATA_MODEL.md`
- `docs/SYNC_PROTOCOL.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/TEST_PLAN.md`
- `docs/ROADMAP.md`
- `docs/REFERENCES.md`
- `references/ui-layout-preview.html` (visual design reference, not an implemented UI)

Treat these as the initial product specification. If APIs or dependency capabilities have changed, check official docs, document the new decision, and update affected references. Code and tests determine what is actually implemented; the spec does not imply completion.

## Stack

| Layer | Preferred implementation |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript strict mode |
| Web | Next.js App Router, React, Tailwind CSS v4, shadcn/ui, Lucide |
| Web forms | React Hook Form, Zod |
| Browser extension | WXT, MV3, React, TypeScript, Tailwind |
| Browser state | Chrome tabs/windows/tabGroups/alarms/sidePanel APIs |
| Local persistence | IndexedDB (Dexie or maintained equivalent) |
| Web authentication | Better Auth, verified for extension integration |
| Database | PostgreSQL + Prisma, server-only |
| API | Authenticated versioned Next.js Route Handlers |
| Sync | Durable local outbox, server change log, incremental pull, optimistic concurrency |
| Deployment | Docker, Coolify, self-hosted VPS, HTTPS |
| Testing | Vitest, React Testing Library, Playwright, extension integration testing |

Verify **current compatible stable** dependency versions; do not force the most recent release candidate. Avoid unnecessary services such as Redis, Kafka, WebSockets, or separate API servers in the MVP. Document tradeoffs when introducing any of them.

## Core domain concepts

- **Live Session:** Observed state of current tabs/windows on one Chrome installation; device-local and ephemeral.
- **Saved Session:** User-controlled reusable saved layout, versioned and eligible for optional sync.
- **Recovery Snapshot:** Immutable automatic local checkpoint used for crash recovery; not automatically cloud-synced by default.
- **Workspace:** Named organization of sessions and resources by project/client/topic.
- **Session Version:** Historical immutable saved-session revision.
- **Device:** Registered extension installation/browser profile (not simply an operating-system machine).
- **Sync Operation:** Durable, idempotent local or server mutation with version preconditions.

Never map persistent session identity to Chrome runtime tab/window/group IDs. Never silently push remote browser tab actions.

## Extension UI

### Popup — fast tasks

Compact first-use experience and daily shortcuts:

- Header and explicit sync status.
- Tab/session search.
- Primary **Save current window** action.
- Secondary **Save all windows** action.
- Recent saved sessions.
- Open full manager / open side panel.
- Account, device, settings, and onboarding entry points.
- Clear distinction between local-only, pending sync, synced, and error states.

### Full extension manager — power tasks

- Tabs and windows currently open in the browser.
- Saved sessions, workspaces, and local recovery snapshots.
- Search/filter by title, URL, workspace, date, source device.
- Session rename/duplicate/archive/delete/pin.
- Tab grouping, selecting, reordering, bulk operations.
- Restore full session/selected tabs with **new window by default**.
- Preview, confirm, run, and summarize restore results.
- IndexedDB-backed session history; export/import with schema versioning.

### Side panel — active tab navigation

- Dense, keyboard-accessible list of open tabs.
- Per-window and per-tab-group collapsible sections.
- Favicon/title, active/pinned indicators, close/focus/move.
- Search and optional duplicate detection.
- Quick workspace switching, recently saved sessions.

**Requirements:** list virtualization, incremental updates, controlled browser API calls, full keyboard support and accessible semantics. Optimize for several hundred open tabs and thousands of saved records.

## Web application UI

Dashboard sections:

- Overview
- Workspaces
- Saved Sessions
- Devices
- Recovery (remote only if recovery sync is separately enabled; otherwise show local-only limitations)
- Search
- Settings (Profile, Privacy, Sync, Devices, Backups, Account)

Desktop: persistent left navigation, top global search bar, central data-dense session list, contextual session-details inspector. Tablet: collapsible nav; mobile: stacked views and detail routes, not unreadably squeezed columns.

Include device source, session/version metadata, tab/window count, last updated time, sync state, session actions, and explicit restore guidance.

**The website does not directly access Chrome tabs.** Browser restoration requires the local extension and a user-triggered, authenticated/allowlisted bridge; absent the extension, allow viewing/export and safe opening of individual URLs as web links.

Design style: modern, professional, information-dense, neutral warm background, charcoal text, restrained emerald accent. Light/dark mode, coherent spacing tokens, visible focus and proper responsive states. Follow `docs/UI_UX_DESIGN.md`, including detailed screen wireframes.

## Authentication and cloud sync

The user's scenario must work:

1. Install extension on Windows -> save a session locally.
2. Opt into cloud sync and sign in.
3. Background sync uploads the saved session after local commit.
4. Install extension on macOS -> sign in as same user with a **different installation ID**.
5. Incrementally download saved sessions/workspaces.
6. Preview and restore the Windows session on the Mac in **a new local window**.
7. Leave the original Windows browser state untouched.

Authentication: web Better Auth account plus an audited browser-extension authorization mechanism. Evaluate the official extension guide, explicit trusted origins, and a short-lived one-time pairing/PKCE exchange as needed. No server secrets in the extension; require device-scoped revocable credentials. Do not rely on broad wildcard trusted origins or casual cross-origin cookie sharing.

Sync invariant: **Local write first, durable outbox second, eventual server acceptance, incremental pull; failures never erase local recoverable state.**

Mandatory features:

- Device registration and revocation.
- Incremental server-ordered changelog and pull cursor.
- Push idempotency keys (retry-safe).
- Optimistic entity versions and explicit conflicts.
- Tombstones and deletion retention.
- Retry with exponential backoff/jitter.
- Per-operation outcome reporting and meaningful sync indicators.
- Offline edits that replay after reconnect.
- Correct cross-device edits without data loss.
- Local snapshots remain intact if sync fails.
- Explicit opt-in for cloud URL/session upload.

Document exact API contracts, request/response Zod schemas, and transaction rules before implementing sync.

## Local recovery and backups

- Observe tab/window/group lifecycle events.
- Debounce and coalesce frequent changes; create bounded snapshots on an alarm/checkpoint schedule.
- Persist checkpoints atomically in IndexedDB.
- Recover and reconcile on browser startup; do not assume clean shutdown/crash is always distinguishable.
- Record snapshot version/createdAt/source device and bounded retention.
- User-created named checkpoints and saved sessions.
- Export as versioned JSON, import with validation and preview.
- Keep independently exportable local copies: **sync is not backup**.
- Do not claim recovery of cookie state, form data, document contents, scroll positions, or Chrome-internal pages the APIs cannot restore.

Manifest V3 service workers terminate when idle. Register listeners at module scope, use alarms and durable state, and verify restart/replay. Never count on timers or globals for important behavior.

## Data model

Implement a normalized schema based on `docs/DATA_MODEL.md`:

- Auth tables (as generated by current Better Auth adapter).
- Device.
- Workspace.
- SavedSession.
- SavedSessionWindow.
- SavedSessionTab.
- SavedSessionGroup.
- SessionVersion (immutable snapshots).
- RecoverySnapshot (local-first; optional backed-up sync later).
- SyncOperationReceipt and SyncChange.
- UserSyncClock.
- UserSettings and AuditEvent.

User ownership checks on every API. Transactions for mutations affecting session child rows plus changelog and idempotency receipt. Index by account, session/workspace, device, modification time and sync sequence as justified.

The extension must never import Prisma or connect directly to Postgres. Use Zod/shared DTOs and verified APIs.

## Security and privacy

- Cloud sync **off by default**; explain URL/title metadata collection before enrollment.
- Exclude incognito unless user explicitly and separately opts in to a supported flow.
- No cookie reading, page scraping, credential capture, tracking pixels or ad use.
- Filter unsupported schemes (`chrome:`, `chrome-extension:`, `file:`, `about:`, internal URLs) for sync/export/restore per documented policy; communicate what is skipped.
- Support domain and path/query-parameter exclusions/redaction.
- Exact allowed origins, constrained `externally_connectable`, message schema validation, least-privilege permissions and good CSP.
- TLS, server-side authorization, rate limits, secure rotating device tokens, logs that redact URLs/tokens, and account deletion/export.
- Do not advertise end-to-end encryption until genuinely designed/tested.
- Chrome Web Store privacy policy, user data disclosure, purpose and permission justification before publication.

Review `docs/SECURITY_PRIVACY.md` and official Chrome developer docs before any security-critical change.

## Implementation stages

**M0 — Specification & foundation decisions:** Validate current APIs/versions, correct references, capture any architecture decisions.

**M1 — Monorepo skeleton:** pnpm/Turbo/WXT/Next.js/shared packages, local env and test runner.

**M2 — Local extension vertical slice:** Capture all windows/tabs -> persist in IndexedDB -> list/search -> preview and restore -> export/import -> recovery snapshots. No backend required.

**M3 — Backend & web account:** Postgres, Prisma migrations, Better Auth, account-scoped CRUD, responsive UI shell and session lists.

**M4 — Sync & device login:** Secure extension auth, durable outbox, device records, incremental push/pull, version conflicts, offline replay, two-device tests.

**M5 — UX breadth:** Side panel, advanced manager, workspace organization, filters/bulk actions, device page, history.

**M6 — Release readiness:** Failure tests, performance, privacy audit, production Docker/Coolify, database backup/restore, Chrome Web Store packaging.

Follow `docs/ROADMAP.md` for detailed acceptance criteria and avoid implementing later-stage features prematurely.

## Quality gates

MVP is acceptable only when:

1. Unpacked extension installs and captures browser windows/tabs.
2. Saved sessions persist after browser restart.
3. Restore in a new window works and failed URLs are reported.
4. Recoverable local snapshots and versioned export/import work.
5. Web registration/login and server ownership are enforced.
6. Two distinct browser installations share the same account and sync saved sessions.
7. Offline changes replay exactly once logically (retries may occur physically).
8. Duplicate operations never create duplicate sessions.
9. Conflicts do not silently overwrite user data.
10. Web can display/export sessions without installed extension.
11. No unapproved remote browser actions are possible.
12. Lint, typecheck, unit, integration, production builds, and core E2E tests pass.
13. Coolify deployment instructions are checked against an actual deployment or labeled unverified.

## Deliverables and ongoing handoff

Produce working code and update docs. At minimum:

- `README.md`, `AGENTS.md`, `CLAUDE.md`
- `docs/PRD.md`, `docs/COMPETITOR_RESEARCH.md`, `docs/SYSTEM_DESIGN.md`, `docs/UI_UX_DESIGN.md`
- `docs/USER_FLOWS.md`, `docs/DATA_MODEL.md`, `docs/SYNC_PROTOCOL.md`
- `docs/SECURITY_PRIVACY.md`, `docs/TEST_PLAN.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`
- Local Docker setup, production Docker/Coolify guide when implemented.
- Real tests, schemas/migrations, CI, extension bundle when milestones are reached.

At the end of each implementation session, update `docs/PROGRESS.md` with: what is implemented, code paths, test commands/results, what remains, blockers, decisions, and the next independently executable task. If context is reset, the next agent must be able to continue based on the repository alone.

## First command to execute as the agent

Inspect the repo, read `AGENTS.md` plus `docs/PROGRESS.md`, validate the references, create the monorepo skeleton, and implement **M2's smallest working capture -> IndexedDB save -> list -> restore vertical slice**. Run relevant tests/builds and record actual results. Do not stop after creating empty app scaffolds. Do not claim code was written unless it exists.
