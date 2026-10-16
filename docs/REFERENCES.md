# SessionHub — Source & Implementation References

> Sources checked or selected October 2026. URLs and product capabilities may change; review official docs during implementation. This is a focused starting bibliography, **not** a claim that every competitor's latest commercial feature has been independently tested.

## Chrome extensions (primary technical sources)

1. [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — idle shutdown, startup, persistence, `alarms` and IndexedDB considerations.
2. [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) — `storage.local`, `storage.session`, and small `storage.sync` quota (~100 KB).
3. [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) — read tab metadata, create/update/rearrange tabs, sensitive `tabs` permission scope.
4. [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) — queries/creation/focus of browser windows.
5. [Chrome tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) — capture and manage group metadata.
6. [Chrome alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms) — periodic work compatible with MV3 lifecycle.
7. [Chrome sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) — side panel capability and minimum Chrome version.
8. [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) — internal/external messaging, `externally_connectable`, security.
9. [Chrome extensions permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list) — narrow permissions and warning text.
10. [Chrome Web Store developer policies](https://developer.chrome.com/docs/webstore/program-policies) — user data, limited use, disclosure, minimum permissions, packaging.

## Framework and infrastructure

11. [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints) — background, popup, sidepanel, HTML manager page patterns.
12. [WXT documentation](https://wxt.dev/) — framework basics, MV3 build.
13. [Better Auth browser extension guide](https://better-auth.com/docs/guides/browser-extension-guide) — explicit extension origins and auth integration; official example uses Plasmo, adapt carefully to WXT.
14. [Better Auth documentation](https://better-auth.com/docs/introduction) — auth server and adapter guidance.
15. [Prisma Turborepo guide](https://www.prisma.io/docs/guides/deployment/turborepo) — server-only DB package in monorepo; note Prisma's latest documentation may mention an RC, use compatible stable.
16. [Next.js documentation](https://nextjs.org/docs) — App Router, Route Handlers and deployment.
17. [Turborepo documentation](https://turborepo.com/docs) — pipeline and package graph.
18. [Coolify documentation](https://coolify.io/docs/) — application and DB deployments.

## Accessibility / interaction design

19. [WAI-ARIA Authoring Practices — Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) — search/command palette semantics.
20. [WAI-ARIA Authoring Practices — Keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) — focus and keyboard behavior.
21. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — AA target.

## Competitor reference sites (inspiration only)

22. [Session Buddy](https://sessionbuddy.com/) — saved collections, backup/recovery.
23. [Workona](https://workona.com/) — project workspaces and cross-device collaboration with browser tabs.
24. [TabXpert](https://tabxpert.com/) — advanced session/versioning functionality.
25. [Tab Manager Plus](https://github.com/stefanXO/Tab-Manager-Plus) — rapid multi-window tab navigation and open-source implementation.
26. [Tablerone](https://tabler.one/) — workspaces and tabs-to-bookmarks model.
27. [OneTab](https://www.one-tab.com/) — tab parking and restoring.

### Design ethics

Do not copy the competitors' branding, artwork, layout assets, proprietary HTML/CSS, copyrighted text or code. Use their feature categories to define an independent SessionHub product.

## Evidence caveat

Architecture values, colors, screen layouts, table/entity schemas, routes and performance goals in this pack are **proposals**. Chrome and framework constraints cited above are documentation-backed and should still be reconfirmed at implementation time.
