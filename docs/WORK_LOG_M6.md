# M6 release hardening work log

Branch: `feature/m6-release-hardening`; worktree: `/Users/chrisgen19/projects/sessionhub-m6-hardening` (moved from `/private/tmp/sessionhub-m6-worktree` after verification).

## Acceptance and plan (2026-10-17)

Source: issue #5, ROADMAP M6, PRD local-first/privacy/operations acceptance, TEST_PLAN sections 3, 7 and 8.

1. Audit shipped permissions/MV3; add reproducible icons and enforce their presence in release checks.
2. Publish an accurate in-app privacy policy and prepare store disclosures/copy using current behavior; identify operator details still required for publication.
3. Finish backup, isolated restore drill, release/rollback and known-limitations documentation. Verify database readiness and restore failures; fix regressions found by the security/race/failure pass.
4. Run lint, typecheck, unit, database, build, browser and release checks as available; record actual results in PROGRESS and reconcile ROADMAP/TEST_PLAN.

No production host exists (confirmed by user). Live TLS, trusted-proxy, migration and encrypted off-host restore verification remain release gates. Do not claim those complete or publish/deploy anything.

## Outcome

Repository preparation implemented: icons and CSP/ZIP checks; public accurate privacy page; store copy/disclosures and real synthetic screenshots; encrypted backup scripts with exact all-table restore comparison and failure tests in CI; release/rollback/limitations; PostgreSQL readiness and failure recovery; first-tab pin failure retry fix. Roadmap is 6/8, with privacy deployment details and live operational verification still open. Actual commands/results and advisory exceptions are recorded in PROGRESS and SECURITY_REVIEW_M6.
