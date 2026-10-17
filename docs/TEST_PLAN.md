# SessionHub — Verification & Test Strategy

**Status:** Test strategy plus measured implementation evidence. Latest actual commands/results: `PROGRESS.md`; M6 security review: `SECURITY_REVIEW_M6.md`. Proposed coverage below is not automatically claimed complete.

## 1. Test layers

| Layer | Tool | Primary coverage |
|---|---|---|
| Pure domain / validators | Vitest | URL classification, serialization, restore plans, deterministic merge |
| IndexedDB adapter | Vitest + browser-compatible IDB harness | Atomic save/outbox, migration, quota/failure behavior |
| Extension UI | React Testing Library | Popup, manager, side panel, keyboard interactions |
| Extension browser integration | Playwright with Chromium extension profile | Actual tabs/windows/groups, restore and background lifecycle |
| API services | Vitest + Postgres test DB | Authz, idempotency, transaction correctness, version conflicts |
| Web UI E2E | Playwright | Auth, sessions, devices, exports, responsive flows |
| System E2E | Two isolated Chrome profiles + running API/DB | Cross-device simulation, offline sync, retries, revocation |
| Operations | Docker/Coolify staging tests | Build, migrations, health, backup restore, deployment |

Never rely only on mocked `chrome.tabs` for critical browser restoration behavior. API contract tests must exercise a real PostgreSQL backend for concurrency semantics.

## 2. Essential unit test matrix

### Core serialization and URL safety

- Handles zero tabs, multi-window, pinned tabs, collapsed groups, duplicate URLs.
- Stable app UUIDs; don't serialize runtime Chrome IDs as persistent identity.
- Skips/classifies unsupported schemes consistently.
- Redacts/excludes configured domains/query parameters before sync export.
- JSON export/import round trip at current schemaVersion.
- Older import schema migrated where promised, otherwise rejected with useful error.
- Malformed JSON, giant payload, dangerous `javascript:` URL, invalid UUID, overlong title rejected safely.

### Restore planner

- New windows default.
- Order/pinning/group relationships rebuilt in a deterministic plan.
- Unsupported items omitted with visible failures and user-readable reasons.
- Partial restore resumes only failed operations and avoids duplicate successful ones.
- Existing browser state is never silently closed or replaced.

### Sync reducer

- Apply ordered change pages transactionally.
- Duplicate server change or accepted own echo is idempotent.
- Concurrent edits produce explicit conflict or allowed disjoint merge.
- Tombstones defeat stale upserts.
- Account switching never mixes outboxes or cached data.

## 3. Extension service worker failure injection

1. Terminate worker after Chrome state scan but before IndexedDB commit -> prior checkpoint remains; no corrupted partial record.
2. Terminate worker after local+outbox commit -> pending operation persists.
3. Terminate worker after sync POST accepted but before receipt persisted -> same operation ID resubmitted, no duplicated server mutation.
4. Terminate worker after pull data committed but before next page -> persisted cursor resumes correctly.
5. Browser exits during large restore -> user sees recoverable job state and summary of known completed steps after restart.
6. Chrome extension update/IndexedDB migration -> preserves sessions or offers validated backup/export fallback.

## 4. Multi-device acceptance matrix

| Scenario | Expected outcome |
|---|---|
| Windows saves and Mac pulls | Mac sees identical saved URLs/title/group order after sync |
| Mac restores a Windows session | Only Mac's live windows change |
| Windows offline edits metadata | Local use continues; durable queue appears pending |
| Windows reconnects | Queued mutations are accepted once logically |
| Two installs concurrently edit same revision | One accepted; second conflict and preserved local copy |
| Web dashboard edits a synced session | Change emitted to server changelog; extension pulls it |
| User revokes Windows device on web | Windows API denied; its local sessions remain |
| Chrome profile switches accounts | No account A cloud sessions shown to account B |
| Sync consent disabled | No session URL upload; local backup still works |
| Workspace made on the web, another in the extension, a session assigned | Both workspaces and the assignment reach the other profile; its switcher filters by them (E2E `sync-workspaces.spec.ts`) |
| Same workspace renamed in one profile, recolored in the other | Both changes survive (per-field merge) everywhere |
| Workspace with sessions deleted in one profile | Sessions move to No workspace first, then the workspace goes everywhere; no session is deleted, no tab changes |

Test with distinct extension installations/profiles, not merely two browser tabs sharing one IndexedDB.

## 5. Performance and load tests

**Proposed target datasets:** 100 live tabs/10 windows; 500 live tabs/20 windows; 10,000 saved tab records; 50,000 historical tab records. Tune targets based on actual hardware and Chrome behavior.

Measure:

- Time from popup open to interactive search.
- Search latency and max memory for 10,000 rows.
- Worker event coalescing count when opening/closing many tabs.
- IndexedDB transaction duration and snapshot growth over 7 days.
- Sync request size, number of operations, pull page counts.
- Web rendering responsiveness and table virtualization.
- Restore progress and browser behavior at 100/500 URLs with throttling.

Benchmarks need baselines and regression thresholds; don't assert performance without measurements.

### 5.1 Measured baselines (2026-10-16)

Test: `apps/extension/e2e/perf.spec.ts`, run with `pnpm test:perf` (builds first; not part of `pnpm test:e2e` or CI). Sizes: `PERF_WINDOWS` x `PERF_TABS_PER_WINDOW`, default 4 x 30 = **120 live tabs**, 12 tab groups. Results are written to `apps/extension/test-results/perf.json`.

**Environment:** WSL2 (Linux 6.18) on a desktop, 8 vCPU, 9 GB RAM; headless Chromium 156.0.8078.4 via Playwright 1.64.1 with `--renderer-process-limit=4`; pages served by a local Node HTTP server (Playwright route interception inflated restore time about 2.5x, so it is not used); background tabs are discarded after loading to fit in memory. Times are wall-clock round trips from an extension page to the worker and back.

| Metric (120 tabs, 4 windows) | Median of 3 runs | Range | Guard in test | 30 tabs / 2 windows (1 run) |
|---|---:|---:|---:|---:|
| Capture all windows (`session.capture`, median of 3 per run) | 39 ms | 34 to 56 ms | < 1,000 ms | 15 ms |
| Checkpoint, new state written | 28 ms | 20 to 61 ms | < 1,000 ms | 12 ms |
| Checkpoint, unchanged fingerprint | 15 ms | 13 to 26 ms | none | 10 ms |
| Manager inspector render (120-tab tree visible) | 186 ms | 168 to 266 ms | < 2,000 ms | 144 ms |
| Popup open to interactive search | 269 ms | 261 to 449 ms | < 3,000 ms | 233 ms |
| Restore all 120 tabs into 4 new windows | 15.7 s | 11.1 to 25.9 s | < 60 s | 2.4 s |
| Restore per tab | 131 ms | 92 to 215 ms | none | 80 ms |
| IndexedDB usage after the run (3 sessions, 1 checkpoint, 1 job) | 1.2 MB | same | none | 0.45 MB |
| Peak system memory increase (Chromium, 240 live tabs at the end) | about 2.1 GB | 2.0 to 3.0 GB | none | about 0.8 GB |

**Reading the numbers:** capture, checkpoint and UI render are fast and stable. Restore dominates and varies widely: per-tab cost grows with the number of tabs already loading, and on this machine browser tab creation itself is the bottleneck (setting up the same 120 tabs took 12.7 to 27.4 s). A separate 60-tab experiment showed one `chrome.windows.create({ url: [...] })` call is about 1.8x faster than SessionHub's sequential `tabs.create` per tab, and parallel `tabs.create` is not faster. Switching restore to batched window creation is a possible optimization, but it loses per-tab failure detail; see `PROGRESS.md`.

**Not measured yet:** 500 live tabs / 20 windows (would need about 8 GB on this machine), search over 10,000 saved tab records, worker event coalescing counts, restore throttling.

## 6. Accessibility / UX E2E tests

- Tab through popup controls and save action.
- Ctrl/Meta+K focuses search where supported; Esc closes dialogs without data loss.
- Side panel window/group tree operates by keyboard and announces state.
- Restore preview checkbox list and destination radios accessible to screen readers.
- Destructive confirm requires explicit activation and announces scope.
- Responsive views at 375, 768, 1024, 1440 px have no critical horizontal overflow.
- Focus remains predictable after list deletion/archive, modal close and routing.
- Color contrast and status textual alternatives meet WCAG 2.2 AA.

## 7. API security and concurrency tests

- Unauthenticated requests reject.
- User A cannot read/mutate B's session by guessing ID.
- Device ID impersonation rejected.
- Revoked device credentials rejected on every protected endpoint.
- Same idempotency key replayed returns same effect/result.
- Same entity/version edited in concurrent transactions never silently overwrites.
- Invalid payload, nested giant arrays, batch limits, injection attempts rejected.
- Expired sync cursor triggers safe rebootstrap rather than lost changes.
- Per-user ordered changelog is contiguous in **commit-safe** order under concurrency.

## 8. Release checklist

- [ ] No TypeScript / ESLint errors.
- [ ] Unit and integration suites pass.
- [ ] E2E browser tests pass on supported Chrome version(s).
- [ ] Offline save, worker termination and two-device sync tests pass.
- [ ] Multi-user security tests pass.
- [ ] Privacy disclosures/permission rationale reviewed.
- [ ] Chrome extension ZIP is reproducible and source code complies with Web Store MV3 rules. (Reproducibility and the manifest and bundle rules have been checked in CI since 2026-10-17, `DEPLOYMENT.md` section 6; a full Web Store policy review is still pending, icons, CSP and PNG dimensions are now enforced. Public store/operator checks remain pending.)
- [ ] Docker image builds and starts; migrations completed safely.
- [ ] PostgreSQL backup restored successfully on test environment.
- [ ] All final feature claims backed by tests/manual verification.
- [ ] Actual commands/test outputs and remaining blockers recorded in `PROGRESS.md`.

## 9. M6 local hardening pass (2026-10-17)

- `pnpm check --force`: lint, strict typecheck and unit suites, including readiness failure/recovery, packaged-icon/CSP regressions and restore pin/group/window/tab failure paths.
- `pnpm --filter @sessionhub/web test:db`: 60 tests on isolated PostgreSQL 18, non-destructive migrate deploy. Includes auth/ownership, concurrent refresh reuse, shared limiter concurrency and 20 simultaneous copies of a sync operation.
- Web E2E: 47 tests against the standalone build, including public privacy navigation, real device revocation, two-profile sync/conflict, clickjacking and proxy spoof checks. Extension E2E: 9 tests, including offline persistence, worker death and real restore failures.
- `bash infra/scripts/test-backup.sh <test-container> sessionhub_test`: authenticated encrypted dump -> new isolated target -> exact all-table counts/content hashes, plus overwrite/corruption/dump-failure paths. CI runs after database tests. A full staging app restore and real off-host/key-recovery drill remain pending.
- Production container test now includes database pause -> health 503 -> database resume -> health 200, with cleanup in `finally`. Actual local outcome is recorded in PROGRESS.
- Release ZIP built twice and checked for equality, permissions, host, packaged code, CSP and real PNG dimensions. Placeholder `.invalid` ZIP is intentionally not a deployable artifact.
- `pnpm audit --prod`: 2 high + 1 moderate in unused MySQL/Prisma-config paths, reviewed exceptions with evidence and re-review date in SECURITY_REVIEW_M6.md; the audit is not claimed clean.

### 9.1 Restore remeasurement

2026-10-17, macOS Apple Silicon, Chromium 156.0.8078.4, one run with 4 windows/120 tabs (same local HTTP fixture): capture median 4 ms, checkpoint insert 5 ms, unchanged checkpoint median 4 ms, inspector 41 ms, popup 51 ms, restore **3,638 ms / 30.3 ms per tab**, storage 4,330 KB. All existing guards passed. This includes per-tab outcome persistence. Hardware differs from the WSL baseline in section 5.1; no cross-machine speedup claim. An initial simultaneous E2E/perf run collided in Playwright's output directory; the recorded pass ran after the extension suite finished.
