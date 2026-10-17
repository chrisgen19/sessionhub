# Store screenshots

Captured 2026-10-17 from the actual built extension on branch `feature/open-picker` (the open picker replaced the restore dialog), based on `cb50c50`, Chromium 156.0.8078.4 on macOS. Light theme, **1280x800**, unmodified UI; all tab names/URLs are synthetic under the reserved `.example` domain. A default `about:blank` tab is intentionally retained so the open picker shows the real unsupported-tab behavior. No account, credentials or personal browsing data is used.

- `manager.png`: saved session inspector and group/pinned metadata.
- `restore-preview.png`: the open picker: ticked tree, destination menu (new windows, one new window, this window) and the browser page that won't open.
- `restore-result.png`: the inline summary after the actual open, with the skipped browser page.

Regenerate from the repository root after building the extension:

```sh
node infra/scripts/capture-store-screenshots.mjs
```

The script uses Playwright already installed with the extension and a disposable browser profile. Synthetic page requests are fulfilled locally. Timestamps reflect capture time; regenerated screenshots need visual review. Upload-preview/conflict/account screenshots must use synthetic staging data and the production-compatible review service before final submission. Check current store image requirements at submission.
