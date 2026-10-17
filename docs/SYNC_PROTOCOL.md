# SessionHub — Cross-Device Sync Protocol v1

> **Status:** Proposed contract, **not yet implemented**. URL paths and JSON examples are illustrative, to be finalized into `packages/contracts` Zod schemas.
>
> **Design rule:** Local save is authoritative for offline durability; the server is authoritative for canonical shared revisions. Remote sessions are data for explicit local restoration, never browser commands.

## 1. Problem and expected behavior

- A Windows extension saves a local session and optionally uploads it.
- A Mac extension signed into the same account downloads it.
- Both devices may make edits, including while offline.
- A service worker may terminate mid-operation; a request may reach the server but its response may never arrive.
- Repeating an operation must have a logically exactly-once effect, even if network delivery is at least once.

## 2. Entities eligible for sync

**MVP synced:** SavedSession (including window/group/tab payload), Workspace, optional opted-in preferences.

**Not automatically synced:** LiveBrowserState, local RecoverySnapshots, Chrome runtime IDs, browser cookies, incognito, device token secrets.

Account and device registration data are managed by the auth/API layer, not arbitrary user-supplied sync operations.

## 3. Protocol invariants

1. Each client operation has a stable `clientOperationId` (UUID), `deviceId`, `entityId`, `entityType`, `action`, and `expectedVersion` for changes to existing records.
2. A local mutation and its outbox operation are persisted in one IndexedDB transaction.
3. The server authenticates identity, validates device and resource ownership, then processes the mutation transactionally.
4. An accepted operation writes canonical data, increments revision, appends one ordered account change event and writes the idempotency receipt atomically.
5. Duplicate delivery with the same `(userId, deviceId, clientOperationId)` returns the original result, not a new mutation.
6. A stale edit returns a conflict response and keeps the client edit recoverable. No default last-write-wins for content.
7. A pull cursor advances locally only after *all changes in the page* are applied in a durable IndexedDB transaction.
8. Remote pull never closes/opens Chrome live tabs.
9. Deleted objects produce tombstones visible to lagging clients; deletes cannot be overwritten by stale upserts.
10. Accounts are isolated, including local caches/outboxes when switching logged-in users.

## 4. API boundaries

| Method | Route (proposed) | Purpose |
|---|---|---|
| `POST` | `/api/v1/devices` | Register installation with authenticated user |
| `GET` | `/api/v1/devices` | List account-owned devices |
| `PATCH` | `/api/v1/devices/:id` | Rename device |
| `POST` | `/api/v1/devices/:id/revoke` | Revoke device credentials |
| `GET` | `/api/v1/sessions` | Paginated canonical saved sessions |
| `GET` | `/api/v1/sessions/:id` | Session details/version, ownership checked |
| `GET` | `/api/v1/sessions/:id/versions` | History list |
| `GET` | `/api/v1/workspaces` | Workspace list |
| `POST` | `/api/v1/sync/push` | Submit small bounded batch of local operations |
| `GET` | `/api/v1/sync/pull?cursor=...&limit=100` | Retrieve ordered changes |
| `GET` | `/api/v1/sync/bootstrap` | Rebuild canonical client cache after expired cursor |
| `POST` | `/api/v1/exports` | Authorized export (optional; could be client-created) |
| `DELETE` | `/api/v1/account/data` | User-approved deletion procedure |

Every endpoint enforces authentication, device revocation where relevant, validation, ownership, method-specific rate limits, and response size bounds.

## 5. Push request (illustrative)

```json
{
  "protocolVersion": 1,
  "deviceId": "8c20b166-6156-4728-a9bc-10635ca68ca1",
  "operations": [
    {
      "clientOperationId": "82c98df3-6bcb-4ca2-8411-3d4a8a4d67aa",
      "entityType": "savedSession",
      "entityId": "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
      "action": "upsert",
      "expectedVersion": 0,
      "payload": {
        "name": "Frontend research",
        "workspaceId": null,
        "windows": []
      }
    }
  ]
}
```

`expectedVersion: 0` indicates a create attempt for a client-generated UUID, and the server must reject a collision with an unrelated existing entity. Size bounds must be defined (proposed: <=50 operations per batch and a measured payload cap) and validated in Zod/server.

### Push response

```json
{
  "protocolVersion": 1,
  "results": [
    {
      "clientOperationId": "82c98df3-6bcb-4ca2-8411-3d4a8a4d67aa",
      "status": "accepted",
      "entityId": "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
      "serverVersion": 1,
      "serverSequence": "307"
    }
  ]
}
```

For mixed-result batches, report per-operation statuses: `accepted`, `duplicate`, `conflict`, `validation_error`, `permission_denied`, `retryable_error`. A batch-wide auth failure can use HTTP 401/403. Do not imply the entire batch succeeded because the HTTP response was 200.

### Conflict payload

```json
{
  "clientOperationId": "82c98df3-6bcb-4ca2-8411-3d4a8a4d67aa",
  "status": "conflict",
  "code": "SERVER_VERSION_MISMATCH",
  "entityId": "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
  "expectedVersion": 3,
  "serverVersion": 5,
  "serverState": { "name": "Server canonical name" }
}
```

The local pending change, including its original payload, is kept in `conflictDrafts`. Do not delete it on conflict. The UI offers safe reconciliation; the API never silently performs destructive merge.

## 6. Pull response (illustrative)

```json
{
  "protocolVersion": 1,
  "cursor": "opaque-cursor-previous",
  "nextCursor": "opaque-cursor-307",
  "hasMore": false,
  "changes": [
    {
      "sequence": "307",
      "entityType": "savedSession",
      "entityId": "64b7e32a-11f4-4caa-929f-0fab1139a7b0",
      "action": "upsert",
      "version": 1,
      "payload": { "name": "Frontend research", "windows": [] }
    }
  ]
}
```

Cursors should be opaque signed/validated server-side or strictly parsed account-scoped sequence tokens. Never accept a cursor as an authorization mechanism; always scope query to authenticated `userId`.

When `hasMore = true`, keep pulling. If the cursor is too old because log retention expired, return `CURSOR_EXPIRED` with a documented bootstrap path. Pull may include the device's own accepted changes—applying them must be idempotent.

## 7. The sync worker

```text
On startup / alarm / network change / explicit Sync Now:
  1. Verify local cloud-consent flag and valid account+device credentials.
  2. Acquire local lease with expiry (avoid duplicate simultaneous pumps).
  3. Read a bounded ordered batch of eligible outbox operations.
  4. POST push with stable clientOperationIds.
  5. Apply per-operation receipts locally; keep conflicts and retriable errors.
  6. GET pull after last safely committed cursor.
  7. For each page:
     - validate payloads
     - check local dirty/conflicting entity status
     - apply clean canonical updates + tombstones transactionally
     - persist new cursor in the same transaction
  8. Repeat while pages remain and time budget allows.
  9. Release lease; schedule bounded retry if needed.
```

A lease is only advisory: it must expire after unexpected worker shutdown. Safety comes from idempotency, transactions, and cursor commits—not from assuming one process will run forever.

### Backoff policy

- First retry delay 5 seconds; grow exponentially with jitter to a reasonable cap (e.g. 15 minutes); implementation can tune.
- Respect server `Retry-After` on rate limiting.
- Suspend on invalid/revoked auth and require reauthentication; don't hammer the server.
- Persist retry attempts and next permitted time in IndexedDB.
- Recheck connectivity as a hint, not as a guarantee; HTTP failures determine actual retry behavior.

## 8. Server transaction / event ordering

For an accepted update, perform **one PostgreSQL transaction**:

1. Lock/auth-check user and target resource, check device not revoked.
2. Look up idempotency receipt.
3. Compare entity `expectedVersion` to current version.
4. Validate payload and update canonical rows and immutable SessionVersion.
5. Acquire a per-user sync clock lock and increment `lastSequence`.
6. Write `SyncChange` with that sequence.
7. Write operation receipt with the same transaction outcome.
8. Commit and return the receipt.

Use a per-user row update/lock to ensure change sequence assignment respects transaction serialization. Avoid assigning unordered Postgres sequence numbers outside commit-safe ordering and then claiming incremental pull cannot skip changes.

On conflict, ensure conflict result can also be repeatably returned by receipt semantics or recomputed consistently; don't turn a stale op into an accidental accepted update on retry.

## 9. Conflict policy

| Conflict type | Automatic response | User-visible resolution |
|---|---|---|
| Disjoint safe metadata fields | Merge only with explicitly specified semantic rules | Show merged result in history |
| Same name/description edited concurrently | Preserve both versions; mark conflict | Keep mine / Keep server / Save copy |
| Tab/window structure modified on both devices | No blind merge; preserve conflict draft | Compare revisions / Save both |
| Server tombstone vs offline edit | Never resurrect automatically | Restore as a *new* saved session |
| Workspace deleted while session edited | Keep session unassigned or create review state, per explicit invariant | Move session / recreate workspace |
| Duplicate create IDs | Reject collision; preserve local and remap to new ID after user-safe migration | Retry as new session |

Always retain immutable versions and conflict drafts until deliberate resolution or policy-governed retention; never discard conflict payload on a 409.

## 10. When the user edits on the website

Web changes go through the **same server mutation/version/change log service** as extension pushes; they must emit SyncChange events. Do not implement web CRUD as direct table edits that bypass the changelog. The extension eventually pulls the same canonical result.

## 11. Delete/tombstone policy

A delete creates a new server version/tombstone and a SyncChange event. Clients apply the tombstone to the saved-session library (but not to unrelated local recovery history or live Chrome tabs). Preserve undo/restore ability during a documented retention window.

On a very stale client with an expired cursor: keep its outbox, fetch a full canonical snapshot, and reconcile queued local edits by version or copy semantics. Never wipe local unsynced changes during rebootstrap.

## 12. Security, privacy, and operation-level limits

- Each push and pull request is authenticated and scoped to user/account/device.
- Client-sent `deviceId` is checked against the authenticated credential, never trusted by itself.
- Request schema and serialized size validated.
- URL exclusions/redaction applied **before upload** as well as in server validation.
- Don't include tokens, private tab URLs, or full request payloads in routine logs.
- Rate-limit, cap pagination/batches, and guard against giant nested/recursive input.
- Validate exported data and imported records by format/schema version.
- Ensure GDPR/other relevant deletion/export capabilities as product requirements are refined with legal guidance.

## 13. Failure and test matrix

| Test | Expected outcome |
|---|---|
| Kill extension worker after local commit | Outbox remains and resumes |
| Kill worker after request accepted but before response | Same ID retry produces one canonical change |
| Same push repeated 20 times | One server mutation/version increment |
| Two devices update version N simultaneously | One accepts; other conflicts or safe merge; both recoverable |
| Web update during offline extension | Extension detects newer server version and preserves local edit |
| Pull page applied but worker dies before next request | Cursor matches committed records and replay is safe |
| Pull endpoint returns an expired cursor | Safe bootstrap preserves unsynced local operations |
| Delete on A, stale edit on B | Tombstone protected, local edit copied or reviewed |
| Sign out A, sign in B on same browser profile | No cross-account cache or outbox leak |
| Device revoked | Further sync denied, local sessions remain |
| Sync disabled | Zero session metadata uploads |
| Cloud API unavailable | Local save/search/restore still function |

## 13a. Implemented: saved-session REST API (2026-10-16)

The web dashboard's API and the shared mutation service that `sync/push` will reuse (section 10). Contracts: `packages/contracts/src/api-sessions.ts`. Service: `apps/web/src/server/sessions/`. Routes: `apps/web/src/app/api/v1/sessions/`.

| Method and path | Success | Errors |
|---|---|---|
| `GET /api/v1/sessions?limit=1..100&cursor=` | 200 `{ items: ApiSessionSummary[], nextCursor }`, newest first, live sessions only (archived included and flagged) | 400 `VALIDATION_ERROR`, `INVALID_CURSOR` |
| `GET /api/v1/sessions/:id` | 200 `ApiSessionDetail` (windows, groups, tabs) | 404 `NOT_FOUND` (missing, deleted, another user's or non-UUID id) |
| `POST /api/v1/sessions` | 201 detail + `Location`; **200** for an exact retry of the same `id` and content | 400, 409 `ID_IN_USE`, 422 `INVALID_WORKSPACE` |
| `PATCH /api/v1/sessions/:id` `{ expectedVersion, ...fields }` | 200 detail (version + 1) | 404, 409 `VERSION_CONFLICT` with `expectedVersion`, `serverVersion`, `serverState`, 422 |
| `DELETE /api/v1/sessions/:id?expectedVersion=N` | 200 `{ id, version, deletedAt }` (tombstone); repeating it returns the same tombstone | 404, 409 |

All: 401 `UNAUTHENTICATED` without a Better Auth session; responses are `Cache-Control: no-store`; errors are `{ error: { code, message, issues?, expectedVersion?, serverVersion?, serverState? } }`. Writes also require `Origin` equal to the app origin (403 `FORBIDDEN_ORIGIN`), `Content-Type: application/json` (415) and a body of at most 2 MB checked before parsing (413); unknown fields are rejected (400 with field `issues`). Limits: 200 windows, 2,000 tabs per window, 5,000 tabs per session.

**Rate limit (writes):** POST, PATCH and DELETE share one per-user token bucket: **30 back to back, then 1 per second (60 per minute sustained)**. Over the limit: `429 RATE_LIMITED`, `Retry-After: <seconds>` and `retryAfterSeconds` in the body; nothing is changed. The check runs after the same-origin check and authentication (anonymous or cross-site requests never use a user's budget) and before the body is read. Reads are not limited yet. Buckets live in process memory (one web instance; at most 10,000 tracked users, fully refilled buckets dropped first).

**Transaction rules (one PostgreSQL transaction per write):**

1. Lock the caller's `user_sync_clocks` row **first** (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`) and take the next sequence. This serializes one user's writes in commit order (pull can't skip a sequence), makes the version check race-free and gives every write the same lock order (no deadlocks).
2. Load the session scoped by `user_id`; another user's row is indistinguishable from a missing one.
3. Compare `expectedVersion`; on mismatch roll back and return 409 with the canonical server state.
4. Write canonical rows. The UPDATE also matches `version = expectedVersion AND deleted_at IS NULL` (defense in depth; verified to hold even with the lock removed).
5. Insert an immutable `session_versions` row (payload = detail DTO, checksum = SHA-256 of id-independent content) and a `sync_changes` row with the sequence.
6. Replays (exact create retry, repeated delete) and conflicts roll back, so they consume **no** sequence: the change log stays gap-free.

**Semantics:** only the session id is stable; window, group and tab ids are server-assigned on every write (group references are remapped), and every URL is re-classified server-side. Deletes are tombstones (`deleted_at`, version + 1, `sync_changes` delete with null payload, no `session_versions` row); a tombstone can't be edited back (404). Web writes record source "Web" with no device. Receipts (`sync_operation_receipts`) exist for device pushes only (13f). **Not yet:** read rate limits and shared (multi-instance) limiter storage, `/versions` history.

## 13b. Implemented: workspace REST API (2026-10-16)

Contracts: `packages/contracts/src/api-workspaces.ts`. Service: `apps/web/src/server/workspaces/`. Same authentication, origin, body, rate-limit and transaction rules as 13a (clock lock first, version check, guarded UPDATE, one `sync_changes` row with `entity_type = workspace`, replays and conflicts roll back without using a sequence).

| Method and path | Success | Errors |
|---|---|---|
| `GET /api/v1/workspaces` | 200 `{ items: (ApiWorkspace & { sessionCount })[] }`: every live workspace (max 100 per account) by `position`, then creation | 401 |
| `POST /api/v1/workspaces` `{ id?, name, description?, icon?, color?, position? }` | 201 `ApiWorkspace` + `Location`; **200** for an exact retry of the same `id` and content | 400, 409 `ID_IN_USE`, 422 `LIMIT_REACHED` (100 live workspaces) |
| `PATCH /api/v1/workspaces/:id` `{ expectedVersion, ...fields }` (at least one field) | 200 (version + 1) | 404, 409 `VERSION_CONFLICT` with `serverState` (the workspace) |
| `DELETE /api/v1/workspaces/:id?expectedVersion=N` | 200 `{ id, version, deletedAt }`; repeating it returns the same tombstone | 404, 409 `VERSION_CONFLICT`, 409 `WORKSPACE_NOT_EMPTY` with `sessionCount` |

Fields: `name` trimmed 1 to 120 chars; `description` up to 1,000; `icon` a short key matching `^[a-z0-9-]{1,40}$` (never markup or a URL); `color` one of the tab-group colors or null; `position` 0 to 10,000. `sessionCount` counts live sessions (archived included) and is not part of the versioned payload.

**Delete policy:** a workspace with live sessions can't be deleted. Moving sessions out is a versioned edit of each session, so the user does it explicitly; a delete never rewrites sessions as a side effect. Because every write takes the user's clock lock first, a delete and a concurrent "create session in this workspace" are serialized: one of them sees the other's result (verified: a session can't be created in a deleted workspace, 422 `INVALID_WORKSPACE`).

## 13c. Implemented: device REST API (2026-10-16)

Contracts: `packages/contracts/src/api-devices.ts`. Service: `apps/web/src/server/devices/service.ts`. Devices are account metadata, not synced entities: no versions and no `sync_changes`.

| Method and path | Success | Errors |
|---|---|---|
| `GET /api/v1/devices` | 200 `{ items: ApiDevice[] }`: active devices by `lastSeenAt` (newest first), then revoked ones (max 200) | 401 |
| `PATCH /api/v1/devices/:id` `{ displayName }` | 200 `ApiDevice` (name trimmed, 1 to 120 chars) | 400, 404 |
| `POST /api/v1/devices/:id/revoke` (no body) | 200 `ApiDevice` with `revokedAt`; sets `revoked_at` once and increments `auth_credential_version` once, repeating it changes nothing | 404 |

`ApiDevice` is `{ id, displayName, browser, platform, createdAt, lastSeenAt, revokedAt }`; the installation id is never returned. Writes use the same origin check and per-user write budget as 13a. Another user's device id is a 404 and nothing changes.

**Deferred to M4:** `POST /api/v1/devices` (registration) is part of extension pairing, which issues the device credential that revocation invalidates. Until then devices exist only as seeded test rows.

## 13d. Implemented: pairing and device credentials (2026-10-16)

Contracts: `packages/contracts/src/api-pairing.ts`. Server: `apps/web/src/server/devices/` (`pairing.ts`, `credentials.ts`, `tokens.ts`). Extension: `apps/extension/src/lib/account-service.ts`. Security model: `SECURITY_PRIVACY.md` 5a.

| Method and path | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/v1/pairing` `{ installationId, deviceName, browser?, platform? }` | none (per-IP limit) | 201 `{ deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn: 600, interval: 5 }` | 400, 429 |
| `POST /api/v1/pairing/decision` `{ userCode, decision: "approve" \| "deny" }` | web cookie + same origin | 200 `{ status: "approved", device }` or `{ status: "denied" }` | 403 `EMAIL_NOT_CONFIRMED`, 404 (unknown, expired or already decided) |
| `POST /api/v1/pairing/token` `{ deviceCode }` | none (per-IP limit) | **202** `{ status: "pending", interval }`; **200** `{ status: "approved", credentials, device, account }` once | 403 `PAIRING_DENIED`, 410 `PAIRING_EXPIRED` (expired, redeemed or unknown), 429 (polled faster than the interval) |
| `POST /api/v1/devices/token` `{ refreshToken }` | none (per-IP limit) | 200 new `{ accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }` | 401 `INVALID_TOKEN`, 401 `DEVICE_REVOKED` (revoked, or reuse detected: the device is revoked by this call) |
| `GET /api/v1/devices/me` | Bearer | 200 `{ device, account: { id, name, email } }` | 401 |
| `POST /api/v1/devices/me/disconnect` | Bearer | 200 `ApiDevice` (revoked) | 401, 429 |

Bearer = `Authorization: Bearer shd_at_...`, validated against the database on every request (see 5a). The sync endpoints (next M4 slices) will use the same `authenticateDevice` gate and require a confirmed email.

`account` (pairing token and `/devices/me`) is `{ id, name, email }`. `id` is the stable account id (Better Auth user id, `^[A-Za-z0-9_-]{1,128}$`) the extension scopes its cached account data by (13e); the email can't serve because it can change. Added 2026-10-16 (M4 local outbox slice); connections stored before then get the id at their next account check.

## 13e. Implemented: local account scope and outbox (2026-10-16)

Extension only; nothing is uploaded yet (`sync/push` is the next slice). Code: `apps/extension/src/lib/account-scope.ts`, `outbox-repository.ts`, `session-repository.ts`; schema and rules: `DATA_MODEL.md` section 4 "Account scope and outbox".

- Invariant 2 (section 3) holds locally: an account-scoped session edit and its operation commit in one IndexedDB transaction, and so does a delete with its tombstone.
- Invariant 10 holds locally: records and operations are scoped `account:<id>`, and only the connected account's are readable or editable. Queued operations of a disconnected account stay stored and hidden, never sent under another account.
- Operation fields map to section 5: `id` = `clientOperationId`, `entityType` (`savedSession`), `entityId`, `action` (`upsert` / `delete`), `expectedVersion` (0 = create), `payload` (the full local session for an upsert, null for a delete). `deviceId` is not stored: the uploader sends the connection's device id, which the server checks against the credential.
- **Contract for the uploader (implemented in 13f):** commit `status: "sending"` (and `attempts + 1`) before a request leaves; never change a `sending` operation's payload or return it to `queued`; send a scope's operations in `seq` order and only for the connected account; on acceptance remove the operation and set the session's `sync.serverVersion` to the returned version (`state: "synced"` when no operations remain); on a conflict keep the payload (conflict drafts). Later operations of the same entity already chain on the expected result (`expectedVersion + 1`), so after a conflict they conflict too and are kept the same way.
- **Contract for pull (implemented in 13g):** don't overwrite an entity with pending operations or a tombstone; purge a tombstone once the pulled change log has passed its delete.

## 13f. Implemented: sync push (2026-10-16)

Contracts: `packages/contracts/src/api-sync.ts`. Server: `apps/web/src/server/sync/push.ts`, route `apps/web/src/app/api/v1/sync/push/route.ts`. Extension: `apps/extension/src/lib/sync-uploader.ts`, `sync-batch.ts`.

`POST /api/v1/sync/push` `{ protocolVersion: 1, deviceId, operations: [...] }`, `Authorization: Bearer shd_at_...` only (cookies never authenticate it). Checks in order:

| Check | Failure |
|---|---|
| Valid device access token | 401 `UNAUTHENTICATED` / `INVALID_TOKEN` / `ACCESS_TOKEN_EXPIRED` / `DEVICE_REVOKED` |
| JSON body (2 MB cap, `application/json`), envelope: `protocolVersion` 1, `deviceId` UUID, 1 to **25** operations | 413, 415, 400 `INVALID_JSON` / `VALIDATION_ERROR` |
| `deviceId` equals the token's device | 403 `DEVICE_MISMATCH` |
| At most one operation per `entityId` | 400 `VALIDATION_ERROR` |
| Confirmed email (when this server can send email) | 403 `EMAIL_NOT_CONFIRMED` |
| Write budget: one token **per operation** from the account's shared budget (13a) | 429 `RATE_LIMITED` + `Retry-After`, nothing applied |

Then 200 `{ protocolVersion: 1, results }`, one result per operation in request order. Operations are validated **one at a time** (a malformed one can't block the others) and each runs in **its own transaction**: lock the user's clock, look up the receipt `(user, device, clientOperationId)`, run the shared session mutation (`createSessionInTx` / `updateSessionInTx` / `deleteSessionInTx`, with the device as provenance), write the receipt. A push is not all-or-nothing.

| `status` | Meaning | Receipt |
|---|---|---|
| `accepted` | `serverVersion`, `serverSequence` (null when the service's own idempotent repeat changed nothing: same create content again, delete of a tombstone) | yes, in the mutation's transaction (none for the service's idempotent repeat) |
| `conflict` | `code: VERSION_CONFLICT`, `expectedVersion`, `serverVersion` (no server state: the pull brings it) | yes |
| `rejected` | `NOT_FOUND` (missing, tombstoned or another account's: indistinguishable), `ID_IN_USE` (create collided), `INVALID_WORKSPACE` | yes |
| `validation_error` | `issues`; `clientOperationId` null if it wasn't a UUID | no (recomputed identically) |
| `retryable_error` | unexpected server failure; send the same operation again | no |

- **Repeats:** a receipt hit returns the stored result with `replayed: true` (this replaces section 5's `duplicate` status, so clients have one code path). 20 concurrent deliveries of one operation make exactly one change (tested).
- **Conflict and rejection receipts** are written after the mutation rolled back (it used no change-log sequence, which stays gap-free). If a concurrent copy recorded first, its result is returned. Because they are stored, a retry can never turn a stale edit into an accepted one, even after the server later reaches the version the client expected (tested).
- **Not used:** section 5's `permission_denied` (another account's session is `NOT_FOUND`).
- **Payload of an upsert:** `{ name, windows }` with the same window/group/tab input rules as 13a; `expectedVersion` 0 creates with `entityId` as the id. Web-only fields (description, workspace, pinned, archived) are left as they are.

**Extension uploader** (`pushNow`), following 13e:

1. Runs only while connected (account id known) and when `syncState.enabledAt` is set for that account (local consent; set by the upload-preview slice, not yet built). Respects `nextAttemptAt` unless forced (`sync.pushNow` command).
2. Per round, in one IndexedDB transaction: select the first pending operation of each session in queue order (sessions with a `conflict` or `rejected` operation are held back entirely), up to 25 operations and 1.5 MB; mark operations that can never fit `rejected`; commit `sending` and `attempts + 1`.
3. Push with the connection's device id and access token (refresh and revocation handling from 13d).
4. Apply results in one transaction: `accepted` (and `rejected NOT_FOUND` for a delete) removes the operation and sets `sync.serverVersion` (`synced` when nothing else is waiting); `conflict` and `rejected` keep the operation with its payload (status `conflict` / `rejected`, session state `conflict`); `validation_error` keeps it as `rejected` (session state `error`); `retryable_error` or a missing result leaves it `sending`.
5. Up to 10 rounds per run. When the cap ends a run with operations still sendable (not held back), it arms the retry alarm at once to continue. Failures back off 5 s doubling to 15 minutes with jitter, or longer if `Retry-After` says so; the retry alarm (`sync-retry`) runs it again. Revocation stops it (the connection is removed; queued operations stay).
6. Triggers: worker start (resends anything left `sending`), after a successful `session.rename` / `session.delete`, the retry alarm, and `sync.pushNow`. One run at a time per worker (in-memory single flight; safety comes from receipts, not from this).

**Not yet:** conflict resolution UI (conflicting operations and the held server copy are both kept, 13g), the opt-in/upload preview that sets `enabledAt`, URL exclusions before upload (no exclusion settings exist yet).

## 13g. Implemented: sync pull and bootstrap (2026-10-16)

Contracts: `packages/contracts/src/api-sync.ts`. Server: `apps/web/src/server/sync/pull.ts`, `cursor.ts`, `device-reader.ts`; routes `api/v1/sync/pull`, `api/v1/sync/bootstrap`. Rules: `packages/sync/src/reconcile.ts`. Extension: `sync-downloader.ts`, `sync-apply.ts`, `sync-runner.ts`.

Both endpoints: `Authorization: Bearer` device token only, confirmed email when this server sends email (403 `EMAIL_NOT_CONFIRMED`), `Cache-Control: no-store`. Reads are not rate-limited yet (M6 item).

| Method and path | Success | Errors |
|---|---|---|
| `GET /api/v1/sync/pull?cursor=&limit=1..100` | 200 `{ protocolVersion: 1, cursor, nextCursor, hasMore, changes }`; no cursor = from the start of the log | 400 `VALIDATION_ERROR`, 400 `INVALID_CURSOR`, 410 `CURSOR_EXPIRED` |
| `GET /api/v1/sync/bootstrap?after=<id>&limit=1..100` | 200 `{ protocolVersion: 1, cursor, nextAfter, hasMore, items }` | 400 |

- **Changes** are `{ sequence, entityType: savedSession \| workspace, entityId, action: upsert \| delete, version, payload }`, in sequence order, with the stored DTO as `payload` (null for deletes). A page also stops once its payloads pass 4 MB (it always holds at least one change).
- **Cursors** are `c1.<sequence>.<mac>`: an HMAC-SHA256 over (user id, sequence) with a key derived from `BETTER_AUTH_SECRET`, truncated to 22 characters, compared in constant time. Another account's or an edited cursor is `INVALID_CURSOR` (tested). It is never authorization: every query is scoped to the authenticated user. Rotating the secret invalidates all cursors, and clients rebuild.
- **`CURSOR_EXPIRED`** when the cursor is ahead of the user's clock (the server lost changes, e.g. a backup restore) or when the change right after it is missing (log pruned). Detection relies on the gap-free log (13a); a false positive only costs a bootstrap. No pruning job exists yet.
- **Bootstrap** pages through the user's sessions by id, **tombstones included as deletes**, each as a change without a sequence (its current version and detail). `cursor` is the clock read **before** the rows: the client keeps the first page's and pulls from it afterwards; changes written meanwhile replay harmlessly because clients apply by version. Sessions only: workspaces join when the extension stores them.

**Extension download** (`pullNow`, run by `syncNow` after a successful push; same consent gate and backoff as 13f, but the backoff covers the whole run and only the pull's success clears it, so a pull that keeps failing backs off even while pushes work):

1. No cursor (first sync of the account) or a rebuild in progress: bootstrap pages. Progress (`syncState.bootstrap`: first cursor + `after`) is stored with each page, so a stopped worker continues.
2. Otherwise pull pages after `syncState.cursor`. `CURSOR_EXPIRED` or `INVALID_CURSOR` clears the cursor and rebuilds; queued changes are untouched.
3. **Each page and its new cursor (or bootstrap progress) commit in one IndexedDB transaction**; a failure keeps neither (tested). Every request uses only the token of the account the run opened for, and the transaction checks that account is still connected: if another account was connected mid-run, the page is dropped and the run ends as disconnected, so one account's data never lands in another's scope (tested; pushes are bound the same way).
4. Each change goes through `reconcileRemoteChange`:
   - a record in another scope (this browser's own sessions, another account's) is never touched
   - a session with outbox operations (any status) is not overwritten: the newest server state is kept in `serverCopies`
   - a local tombstone is never undone, and the server's delete purges it
   - anything not newer than the stored `serverVersion` is ignored (this covers its own uploads coming back)
   - otherwise the session is written as `synced` or removed
   - workspace changes and payloads that don't validate are skipped, so one bad change never blocks a page
5. **Echo reconciliation:** when a push is accepted, `reconcileHeldCopy` settles a held copy:
   - not newer than the accepted version: it was this device's own change, so it is dropped (an own delete also ends its tombstone)
   - newer, with nothing else waiting: it is applied now, because the cursor already passed it
   - newer, with more local changes waiting: it is kept
   - after a conflict it stays for review beside the local change
6. Up to 20 pages per run, then a follow-up run is scheduled. Triggers: as 13f, plus a 10-minute `sync-periodic` alarm and the `sync.now` command (push then pull, which replaces `sync.pushNow`).
7. A pull never opens, closes or navigates tabs: it touches only IndexedDB (verified on both profiles of the two-profile E2E around every pull).

**Local fields not stored:** description, workspace, pinned and archived stay on the server (an upload doesn't change them). Pulled sessions keep the server's `sourceDeviceId`/`sourceDeviceName`.

## 14. References

- [Chrome MV3 service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome storage API and quota notes](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
