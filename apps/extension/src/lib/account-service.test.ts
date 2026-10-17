import { describe, expect, it, vi } from "vitest";
import { cancelPairing, checkConnection, disconnect, getAccountStatus, pollPairing, startPairing, withAccessToken, type AccountDeps } from "./account-service";
import type { ConnectionRecord } from "./db";
import { putSession, listSessions } from "./session-repository";
import { freshDb, idFactory, sampleSession } from "./test-fixtures";

const ORIGIN = "https://sessionhub.example";
const T0 = new Date("2026-10-16T10:00:00.000Z");
const token = (kind: "dc" | "at" | "rt", fill: string) => `shd_${kind}_${fill.repeat(43).slice(0, 43)}`;
const device = { id: "6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", displayName: "Chrome on Windows", browser: "Chrome", platform: "Windows", createdAt: T0.toISOString(), lastSeenAt: null, revokedAt: null };
const credentials = (fill: string, at = T0) => ({
  accessToken: token("at", fill),
  refreshToken: token("rt", fill),
  accessExpiresAt: new Date(at.getTime() + 15 * 60_000).toISOString(),
  refreshExpiresAt: new Date(at.getTime() + 30 * 86_400_000).toISOString(),
});
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number, code: string) => reply(status, { error: { code, message: `${code} message` } });

/** A scripted fake server: each route answers from a queue (last answer repeats). */
const fakeServer = (routes: Record<string, Response[]>) => {
  const calls: { path: string; body: unknown; authorization: string | null }[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: new Headers(init?.headers).get("authorization") });
    const queue = routes[url.pathname];
    if (!queue?.length) throw new TypeError("fetch failed");
    return (queue.length > 1 ? queue.shift() : queue[0])!.clone();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
};

const setup = (routes: Record<string, Response[]>, now = T0) => {
  const server = fakeServer(routes);
  const clock = { now };
  const openTab = vi.fn(async () => undefined);
  const deps: AccountDeps = { db: freshDb(), fetch: server.fetch, now: () => clock.now, createId: idFactory(7), apiOrigin: ORIGIN, openTab, platformOs: async () => "win" };
  return { deps, server, clock, openTab };
};

const pairingResponse = { deviceCode: token("dc", "D"), userCode: "BCDF-GHJK", verificationUri: `${ORIGIN}/app/pair`, verificationUriComplete: `${ORIGIN}/app/pair?code=BCDF-GHJK`, expiresIn: 600, interval: 5 };

const connect = async (routes: Record<string, Response[]> = {}) => {
  const ctx = setup({
    "/api/v1/pairing": [reply(201, pairingResponse)],
    "/api/v1/pairing/token": [reply(200, { status: "approved", credentials: credentials("A"), device, account: { name: "Pat", email: "pat@example.test" } })],
    ...routes,
  });
  await startPairing(ctx.deps);
  await pollPairing(ctx.deps);
  return ctx;
};

const connection = async (deps: AccountDeps) => (await deps.db.account.get("connection")) as ConnectionRecord | undefined;

describe("pairing", () => {
  it("starts with only the installation id and device name, then opens the approve page", async () => {
    const { deps, server, openTab } = setup({ "/api/v1/pairing": [reply(201, pairingResponse)] });
    expect(await startPairing(deps)).toMatchObject({ kind: "pairing", userCode: "BCDF-GHJK", interval: 5, expiresAt: "2026-10-16T10:10:00.000Z" });
    expect(server.calls[0]).toEqual({
      path: "/api/v1/pairing",
      body: { installationId: expect.stringMatching(/^[0-9a-f-]{36}$/), deviceName: "Chrome on Windows", browser: "Chrome", platform: "Windows" },
      authorization: null,
    });
    expect(openTab).toHaveBeenCalledWith(pairingResponse.verificationUriComplete);
  });

  it("keeps waiting while pending or polled early, then stores the credentials once approved", async () => {
    const { deps, server } = setup({
      "/api/v1/pairing": [reply(201, pairingResponse)],
      "/api/v1/pairing/token": [
        reply(202, { status: "pending", interval: 5 }),
        apiError(429, "RATE_LIMITED"),
        reply(200, { status: "approved", credentials: credentials("A"), device, account: { name: "Pat", email: "pat@example.test" } }),
      ],
    });
    await startPairing(deps);
    expect((await pollPairing(deps)).outcome).toBe("waiting");
    expect((await pollPairing(deps)).outcome).toBe("waiting");
    const done = await pollPairing(deps);
    expect(done).toMatchObject({ outcome: "connected", status: { kind: "connected", account: { email: "pat@example.test" }, deviceName: "Chrome on Windows", apiOrigin: ORIGIN } });
    expect(server.calls.filter((call) => call.path === "/api/v1/pairing/token").every((call) => (call.body as { deviceCode: string }).deviceCode === pairingResponse.deviceCode)).toBe(true);
    expect(await deps.db.account.get("pairing")).toBeUndefined();
    expect(await connection(deps)).toMatchObject({ deviceId: device.id, accessToken: token("at", "A") });
  });

  it.each([
    ["PAIRING_DENIED", 403, "denied"],
    ["PAIRING_EXPIRED", 410, "expired"],
  ] as const)("forgets the pairing when the server says %s", async (code, status, outcome) => {
    const { deps } = setup({ "/api/v1/pairing": [reply(201, pairingResponse)], "/api/v1/pairing/token": [apiError(status, code)] });
    await startPairing(deps);
    expect(await pollPairing(deps)).toEqual({ outcome, status: { kind: "disconnected", notice: null } });
  });

  it("expires locally after 10 minutes and can be cancelled", async () => {
    const { deps, clock } = setup({ "/api/v1/pairing": [reply(201, pairingResponse)] });
    await startPairing(deps);
    expect(await cancelPairing(deps)).toEqual({ kind: "disconnected", notice: null });
    await startPairing(deps);
    clock.now = new Date(T0.getTime() + 601_000);
    expect(await getAccountStatus(deps)).toEqual({ kind: "disconnected", notice: null });
    expect((await pollPairing(deps)).outcome).toBe("expired");
  });
});

describe("credentials", () => {
  it("uses the access token directly while it's fresh", async () => {
    const { deps } = await connect();
    expect(await withAccessToken(deps, async (accessToken, origin) => `${origin} ${accessToken}`)).toBe(`${ORIGIN} ${token("at", "A")}`);
  });

  it("refreshes ahead of expiry, once for concurrent callers, and stores the rotated pair", async () => {
    const { deps, server, clock } = await connect({ "/api/v1/devices/token": [reply(200, credentials("B"))] });
    clock.now = new Date(T0.getTime() + 14.5 * 60_000);
    const seen = await Promise.all([1, 2, 3].map(() => withAccessToken(deps, async (accessToken) => accessToken)));
    expect(seen).toEqual([token("at", "B"), token("at", "B"), token("at", "B")]);
    expect(server.calls.filter((call) => call.path === "/api/v1/devices/token")).toEqual([
      { path: "/api/v1/devices/token", body: { refreshToken: token("rt", "A") }, authorization: null },
    ]);
    expect(await connection(deps)).toMatchObject({ refreshToken: token("rt", "B") });
  });

  it("refreshes and retries once when the server says the token expired (clock skew)", async () => {
    const { deps } = await connect({ "/api/v1/devices/token": [reply(200, credentials("C"))] });
    const call = vi.fn(async (accessToken: string) => {
      if (accessToken === token("at", "A")) {
        const { AccountApiError } = await import("./account-api");
        throw new AccountApiError("ACCESS_TOKEN_EXPIRED", "expired");
      }
      return accessToken;
    });
    expect(await withAccessToken(deps, call)).toBe(token("at", "C"));
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("disconnects locally with a notice when the device was revoked, keeping saved sessions", async () => {
    const { deps } = await connect({ "/api/v1/devices/me": [apiError(401, "DEVICE_REVOKED")] });
    await putSession(deps.db, sampleSession());
    expect(await checkConnection(deps)).toEqual({ kind: "disconnected", notice: "revoked" });
    expect(await connection(deps)).toBeUndefined();
    expect(await listSessions(deps.db)).toHaveLength(1);
  });

  it("keeps the connection when the server is unreachable", async () => {
    const { deps } = await connect();
    expect(await checkConnection(deps)).toMatchObject({ kind: "connected" });
  });

  it("disconnect revokes on the server when possible and always forgets the tokens", async () => {
    const online = await connect({ "/api/v1/devices/me/disconnect": [reply(200, { ...device, revokedAt: T0.toISOString() })] });
    expect(await disconnect(online.deps)).toEqual({ kind: "disconnected", notice: null });
    expect(online.server.calls.at(-1)).toMatchObject({ path: "/api/v1/devices/me/disconnect", authorization: `Bearer ${token("at", "A")}` });
    const offline = await connect();
    expect(await disconnect(offline.deps)).toEqual({ kind: "disconnected", notice: null });
    expect(await connection(offline.deps)).toBeUndefined();
  });

  it("won't start a second pairing while connected", async () => {
    const { deps } = await connect();
    await expect(startPairing(deps)).rejects.toThrow("already connected");
  });
});
