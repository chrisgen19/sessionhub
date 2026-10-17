# CLAUDE.md — SessionHub

Read and follow [`AGENTS.md`](./AGENTS.md). There is one shared set of coding rules; do not create a conflicting set for Claude.

At the start of every session:

1. Inspect `docs/PROGRESS.md` and the actual repository state.
2. Read relevant specs referenced in `README.md`.
3. Continue the highest-priority incomplete vertical slice in `docs/ROADMAP.md` unless instructed otherwise.

At the end of every session, update `docs/PROGRESS.md` with changed files, **verified** commands/test results, outstanding issues, and the exact next step.

If the spec and implementation conflict, report the discrepancy and document the decision before changing core sync, recovery, auth, or privacy behavior.

## Local unpacked extension

Chrome loads SessionHub unpacked from **one fixed folder: `~/SessionHub/extension`**. Chrome derives an unpacked extension's ID from its folder path, and a new ID starts with no saved sessions, so never point the user at `apps/extension/.output` or a worktree's build.

- Update it with `pnpm --filter @sessionhub/extension build:unpacked`, then the user clicks the extension's reload button on `chrome://extensions`. It builds against `https://sessionhub.cgdev.site` (override with `WXT_API_BASE_URL`), and `SESSIONHUB_UNPACKED_DIR` overrides the folder.
- The folder is replaced only after a successful build, and a folder holding anything other than a SessionHub build is refused (`apps/extension/scripts/update-unpacked.ts`).
