# CLAUDE.md — SessionHub

Read and follow [`AGENTS.md`](./AGENTS.md). There is one shared set of coding rules; do not create a conflicting set for Claude.

At the start of every session:

1. Inspect `docs/PROGRESS.md` and the actual repository state.
2. Read relevant specs referenced in `README.md`.
3. Continue the highest-priority incomplete vertical slice in `docs/ROADMAP.md` unless instructed otherwise.

At the end of every session, update `docs/PROGRESS.md` with changed files, **verified** commands/test results, outstanding issues, and the exact next step.

If the spec and implementation conflict, report the discrepancy and document the decision before changing core sync, recovery, auth, or privacy behavior.
