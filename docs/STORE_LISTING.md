# Chrome Web Store submission materials

Prepared 2026-10-17 from shipped code. Submission remains pending a production origin, public privacy URL, operator/private support contact, providers and retention, final account-flow screenshots, reviewer account/instructions and the live deployment checks in DEPLOYMENT.md. Do not submit the `.invalid` build or advertise M5 features. No store upload is automated.

## Listing copy

**Name:** SessionHub

**Summary:** Save, search and safely restore your browser windows. Local-first, with optional saved-session sync.

**Description:**

Keep collections of Chrome tabs ready to reopen. Save your current window or all normal windows, including pinned tabs and tab groups. Search by session name, tab title or URL. Choose the windows and tabs to reopen, then open them in new windows, in one new window or in the window you're in, with a result summary and retry for failed tabs. Existing tabs stay open.

Sessions and automatic recovery checkpoints are saved in this browser. No account is needed for local use. Export and import versioned JSON to keep independent copies. Protect exports: they contain readable tab titles and complete URLs.

Optionally pair with your SessionHub account and enable sync after reviewing which sessions will upload. While enabled, new saves and imports sync too. Review conflicting edits and choose which version to keep, or keep both. Sync never opens tabs on another computer.

Recovery checkpoints stay local. Private windows are excluded. SessionHub does not read page contents, cookies, passwords or Chrome browsing history. Saved URLs may contain sensitive information; per-site exclusions and query stripping are not available yet. Cloud data is readable by the server operator; end-to-end encryption is not offered.

Desktop Chrome only. Side panel, live-tab navigation, workspace UI, bulk tools and self-service account deletion are not included in this preview.

## Single purpose and permissions

Single purpose: preserve, find and explicitly restore browser session collections, with optional synchronization of saved collections to the user's account.

| Permission | Dashboard justification |
|---|---|
| `tabs` | Read URLs, titles, order and pinned state from normal windows to save sessions and automatic local recovery checkpoints. |
| `tabGroups` | Save and rebuild tab group names, colors, collapsed state and membership. |
| `favicon` | Display icons through Chrome's favicon endpoint in the session list and inspector, without third-party icon services. |
| `alarms` | Schedule durable debounced recovery checkpoints, periodic recovery and opted-in sync while the MV3 worker can be suspended. |
| One HTTPS host | Contact only the configured SessionHub API for pairing, credentials and explicitly enabled account sync. |

No content scripts, browsing-history API, cookies, scripting, external messaging or broad host permissions. No remote code: the ZIP packages scripts and an explicit self-only extension CSP. Source SVG and 16/32/48/128 PNGs are in `apps/extension/assets` and `public/icons`. Regenerate from the repository root with `node infra/scripts/generate-extension-icons.mjs` after `pnpm install`.

## Privacy Practices dashboard answers

Confirm the current dashboard labels at submission. Disclose data processed locally as well as optionally transferred; do not choose "no data collected" just because sync defaults off.

| Data category | Disclose | Actual use |
|---|---|---|
| Personally identifiable information | Yes | Account name/email and device labels for account service. |
| Authentication information | Yes | Account passwords (hashed server-side), web sessions and device credentials for sign-in/pairing. |
| Web history / visited URLs and titles | Yes | Current tabs captured into saved sessions and automatic checkpoints, optionally uploaded with saved-session sync; no Chrome history API access. |
| Website content | No page body collection | Only tab titles/URLs and group metadata are captured; reconcile the current dashboard definition if it includes titles in this category. |
| Health, financial/payment, personal communications | No dedicated collection | A user-selected URL/title can contain sensitive information; no page bodies, messages or payment fields are read. |
| Location | No geolocation | Account security stores client IPs; disclose IP processing in the policy and use the dashboard's current definition. |
| User activity | No tracking | No clicks/keystrokes/mouse tracking, analytics or telemetry; tab lifecycle events trigger local recovery. |

Certify Limited Use only after reviewing the deployed service: no sale, no unrelated uses, no advertising/credit purposes, no unrelated human review. Public `/privacy` includes the Limited Use statement and explicitly documents tombstones/versions/receipts without automatic purge. Set the privacy URL to `https://<production-origin>/privacy` after hosting; it must be public without sign-in. Private repo links are not a substitute.

## Visuals and reviewer handoff

Included under `docs/store-assets`: real 1280x800 manager, open picker (with its destination menu) and result captures with synthetic URLs (see the provenance README). Regenerate with `node infra/scripts/capture-store-screenshots.mjs`. Additional account-flow captures require a review service. Capture real release-build screenshots with synthetic URLs only: popup save/search, manager tree, restore preview/results, Account upload preview and conflict review. Supply images matching the dashboard's current size requirements. Prepare the small promotional tile if required. Never use real personal tab data.

Use a dedicated test account and documented pairing flow for reviewers. Provide access through the store's private reviewer fields, never a committed password. Include an explanation that local save/restore works without an account, and cloud sync requires pairing plus separate opt-in. Verify the exact ZIP's host permission matches the review server.

## References checked 2026-10-17

- [User Data FAQ and disclosures](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)

Policy text and dashboard fields can change; check them against the final submission and actual deployment. This file is submission preparation, not evidence of store approval.
