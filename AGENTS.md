# AGENTS.md — SessionHub Engineering Instructions

This file is authoritative for any AI coding agent working in this repository.

## Session start: read before coding

1. `docs/PROGRESS.md` — current implementation truth and immediate next steps.
2. `docs/PRD.md` — goals, MVP scope, acceptance criteria.
3. `docs/SYSTEM_DESIGN.md` — component boundaries and documented tradeoffs.
4. Task-related files: `docs/UI_UX_DESIGN.md`, `docs/SYNC_PROTOCOL.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_PRIVACY.md`, `docs/TEST_PLAN.md`.
5. Inspect the **actual repository and current dependencies**; documentation may lag code. Note inconsistencies and reconcile them.

## Rules

- **Do not assume the product has been built** simply because a feature is described in the docs. Verify files, builds, and tests.
- Preserve local-first behavior and recovery safety. Destructive browser actions need preview + clear, in-context consent.
- Cloud sync is opt-in. Do not upload local session URLs without user approval.
- No Prisma/database imports in the extension; server-side data access only.
- Strict TypeScript, named exports where reasonable, and small testable domain modules.
- Use pnpm/Turborepo, Next.js App Router, WXT MV3, Prisma/PostgreSQL and the documented design direction unless an explicit architectural decision supersedes them.
- Validate untrusted data with shared Zod contracts. Validate resource ownership on the server.
- Never use in-memory state as durable state in a Manifest V3 background service worker.
- Use IndexedDB for local session records; Chrome storage areas for small settings/token-management needs where appropriate.
- Do not rely on Chrome runtime tab/window/group IDs as persistent identities.
- All extension/web communication must use allowlisted origins, constrained commands, and explicit user intent.
- Distinguish **saved sessions**, **recovery snapshots**, **workspaces**, and **live device state**.
- Do not implement cloud E2EE claims unless encryption/key recovery have been designed and audited.
- No broad content scripts, browsing-history collection, cookie access, or telemetry without approved product need.
- Do not hardcode dependency versions from this specification; verify compatible current stable versions when initializing.
- Prefer atomic, tested vertical slices over large nonworking scaffolds.

## Practical workflow

Before changes: identify the relevant acceptance criteria and write a brief implementation plan in your work log.

After changes:

1. Run relevant lint, typecheck, tests, and builds (record actual commands and results).
2. Add tests for modified domain or sync behavior and verify error paths.
3. Update `docs/PROGRESS.md` with completed work, commands run, results, blockers, changed decisions, and next steps.
4. Update architectural or UX docs when behavior changes; avoid documentation drift.
5. Summarize what is functional versus pending. Never report unrun tests as passing.

## Work breakdown

Start at `docs/ROADMAP.md`. The first useful vertical slice is *local extension: capture -> save to IndexedDB -> search/list -> restore into a new window -> export*.

Only after local data integrity is tested should you add auth/cloud synchronization.

## Security stop conditions

Stop and redesign before shipping if any user can access another user's sessions, if sync can silently delete or overwrite unrecoverable data, if a web message can trigger unapproved tab creation, or if a secret/server credential is embedded in the extension.

## Repo conventions (provisional until initialized)

- `apps/web`: Next.js server and web UI.
- `apps/extension`: WXT entrypoints, browser API adapters, local persistence and sync runner.
- `packages/core`: pure session/workspace and restore-planning logic.
- `packages/contracts`: request/response schemas and transport DTOs.
- `packages/sync`: pure reconciliation logic and types, no direct DB API.
- `packages/database`: Prisma and server-only adapters.
- `packages/ui`: composable UI primitives and design tokens.

No CLI commands can be asserted working until the monorepo exists. Once initialized, record exact development commands in the repo README and `docs/PROGRESS.md`.
