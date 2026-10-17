# Store screenshots

Captured 2026-10-17 from the actual built extension on branch `feature/m6-release-hardening`, based on `1b9dd50`, Chromium 156.0.8078.4 on macOS. Light theme, **1280x800**, unmodified UI; all tab names/URLs are synthetic under the reserved `.example` domain. A default `about:blank` tab is intentionally retained so restore preview shows the real unsupported-tab behavior. No account, credentials or personal browsing data is used.

- `manager.png`: saved session inspector and group/pinned metadata.
- `restore-preview.png`: additive restore consent and skipped browser-page disclosure.
- `restore-result.png`: per-tab outcome after the actual restore.

Regenerate from the repository root after building the extension:

```sh
node infra/scripts/capture-store-screenshots.mjs
```

The script uses Playwright already installed with the extension and a disposable browser profile. Synthetic page requests are fulfilled locally. Timestamps reflect capture time; regenerated screenshots need visual review. Upload-preview/conflict/account screenshots must use synthetic staging data and the production-compatible review service before final submission. Check current store image requirements at submission.
