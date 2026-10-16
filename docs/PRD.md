# Product Requirements Document — SessionHub

**Status:** Proposed / not implemented  
**Last reviewed:** 2026-10-16  
**Decision owner:** Project maintainer  
**MVP target:** Chrome desktop, Windows and macOS; responsive web dashboard

## 1. Summary

SessionHub is a privacy-conscious, local-first browser session manager. It preserves tab/window collections and automatic recovery snapshots in a Chrome extension, offers organization by workspace, and optionally synchronizes **saved** content between browser installations via a user-owned account and web dashboard.

### The user problem

Heavy browser users keep multiple project contexts open. They lose valuable work when a window closes, struggle to find tabs, and cannot reliably retrieve saved sessions from another computer. Existing tools tend to optimize either rapid tab navigation, long-term session history, or cloud workspaces; SessionHub combines these with explicit recovery and conflict-safety guarantees.

### One-line value proposition

> Keep your browser context safe, searchable, and available when you move between computers.

## 2. Personas and jobs to be done

| Persona | Job | Primary environment |
|---|---|---|
| Developer working across client projects | Save separate issue/PR/docs/localhost windows and resume them later | Windows + macOS, many browser windows |
| Researcher / student | Collect reading sessions, tag them and return days later | Desktop browser + web viewer |
| Power user | Search and focus one tab among hundreds; recover closed windows | Desktop with many live tabs |
| Multi-device user | Save a session on Windows and restore it on a Mac without disrupting Windows | Two distinct Chrome installations |

Core jobs:

1. **Save:** Capture my current window or all windows, name the collection, and know it is durable.
2. **Recover:** Find automatic checkpoints after a crash or mistaken closure, even when offline.
3. **Find:** Quickly locate live or saved tabs by title/URL/workspace.
4. **Organize:** Group sessions into logical workspaces or projects.
5. **Continue:** View saved sessions on a second device, then explicitly restore selected tabs locally.
6. **Trust:** Understand whether data is local, syncing, synced, conflicted, or excluded.

## 3. Product principles

1. **Recovery before convenience:** Default restore is additive, not destructive.
2. **Local-first:** Network/auth must not block capture, search, or restore of local items.
3. **Explicit sync:** Cloud upload is opt-in with transparent metadata disclosure.
4. **Controlled remote access:** Sync never automatically changes live tabs on other devices.
5. **Clarity:** Every saved object has an unambiguous type, origin and timestamp.
6. **Portability:** Exportable versioned JSON; no proprietary lock-in for the user's own URLs.
7. **Density without clutter:** Fast keyboard search and compact professional layouts.

## 4. MVP capabilities

| Area | Must have | Should have later |
|---|---|---|
| Capture | Save current window/all windows, tab titles/URLs/order/pinned/group metadata | Capture per-app context metadata |
| Local recovery | Periodic bounded snapshots, versioned export/import, restore preview | Snapshot diffs and advanced retention controls |
| Tab navigation | Search live tabs by title and URL; focus matching tab | Full keyboard command palette, duplicate cleanup |
| Organization | Rename/duplicate/archive/delete saved sessions; workspaces | Tags, smart folders, shared workspaces |
| Web | Account, dashboard, session detail/list, devices, settings | Detailed analytics, collaboration |
| Sync | Opt-in, offline outbox, device registration, incremental push/pull, safe conflict resolution | Encrypted user-held cloud vault, near-real-time push notifications |
| UI | Popup + full manager; desktop/mobile web layout | Feature-rich side panel if milestone sequencing requires delay |
| Operations | PostgreSQL migrations, HTTPS, Coolify deployment, backup/restore test | Multi-region, advanced observability |

### Explicitly out of scope for MVP

- Automatic opening/closing tabs on remote computers.
- Syncing Chrome cookies, passwords, form input, scroll positions, or localStorage of visited pages.
- Browsing-history surveillance, page content ingestion, AI summarization.
- Browser support beyond Chrome desktop.
- Team collaboration, billing, or subscription payments.
- End-to-end encrypted cloud vault (future security-reviewed feature).
- A guarantee that incognito, internal Chrome URLs, or restricted URLs can be restored.

## 5. Definitions and product semantics

- **Live session:** Ephemeral device-local view of browser tabs/windows; not the cloud source of truth.
- **Saved session:** Editable collection with a durable ID, local source record, and optional cloud counterpart.
- **Recovery snapshot:** Immutable device-local checkpoint; cloud backup of automatic recovery is a later, separately consented feature.
- **Workspace:** User-created collection of saved sessions and links.
- **Device:** Distinct extension installation/browser profile (two Chrome profiles on one PC are two devices).
- **Version:** Historical state of a saved session before/after edits.

## 6. End-to-end acceptance journeys

### Journey A: Save and restore offline

**Given** a user with two windows and 30 tabs is offline, **when** they select Save All Windows, **then** the collection is visible in local sessions after browser restart and can restore into new windows without sign-in.

### Journey B: Windows to macOS

**Given** cloud sync is enabled and the user saved a named session on Windows, **when** they authenticate on a separate macOS browser profile, **then** the saved session appears with its Windows origin label and can be restored into a new Mac window without modifying the source Windows state.

### Journey C: Offline conflict

**Given** devices A and B edit the same saved session while offline, **when** both reconnect, **then** each edit is retained via a deterministic merge or a recoverable conflict copy; neither edit is silently lost.

### Journey D: Sudden termination

**Given** the extension service worker is terminated, **when** it is reactivated by a browser event or alarm, **then** it can resume a pending snapshot or sync safely from durable state.

### Journey E: Web without extension

**Given** a signed-in user on a device without the extension, **when** they open the web dashboard, **then** they can view/export saved sessions but are not offered an impossible direct restore-to-Chrome operation.

## 7. Metrics to validate (targets, not measured results)

| Metric | Initial target | How tested |
|---|---|---|
| Local save success | 100% in deterministic integration test matrix | Automated IndexedDB fault testing |
| Search feedback | Visible response in <=200 ms for 10,000 saved rows on target test hardware | Benchmarked local dataset |
| Restore completion | All supported URLs opened or reported failed; no silent omission | 100/500-tab integration tests |
| Duplicate sync effects | Zero duplicates after repeated POST / retry | Idempotency regression tests |
| Offline persistence | Offline changes remain after forced worker restarts | Simulated network/service-worker failures |
| Account isolation | Zero cross-user read/write results in authz tests | API authorization suite |

These targets may be refined after measurement; never report a target as an achieved result.

## 8. Open decisions to validate in implementation

- Which account onboarding UX yields the safest usable extension authorization with Better Auth?
- Which unsupported URL classes should be stored as labels only versus omitted entirely? Define one consistent classification policy and test it.
- Default recovery snapshot retention (proposed: rolling 7 days / bounded count; require disk and privacy review).
- Whether read-only live-device status belongs in Phase 2; if implemented it must be explicitly consented and cannot imply real-time connection without a heartbeat.
- Whether collaboration requires a new ownership/ACL model (do not pre-optimize MVP schema for active multi-user editing).

## 9. Dependencies and references

Detailed definitions: [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md), [`SYNC_PROTOCOL.md`](SYNC_PROTOCOL.md), [`DATA_MODEL.md`](DATA_MODEL.md), [`UI_UX_DESIGN.md`](UI_UX_DESIGN.md), [`TEST_PLAN.md`](TEST_PLAN.md).
