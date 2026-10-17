import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { randomIp } from "./pairing-flow";

// The test plays the one trusted proxy (TRUSTED_PROXY_COUNT=1): it appends the "real" address
// after whatever a client put in X-Forwarded-For, as Traefik does.
const via = (spoofed: string, real: string) => ({ "x-forwarded-for": `${spoofed}, ${real}` });

test("per-IP limits count the address the proxy saw, not what the client wrote in front of it", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const real = randomIp();
  const start = (spoofed: string, address = real) =>
    api.post("/api/v1/pairing", { headers: via(spoofed, address), data: { installationId: randomUUID(), deviceName: "Chrome", browser: "Chrome" } });

  // Pairing start allows 5 per minute per IP: a fresh spoofed prefix each time doesn't help.
  for (let attempt = 0; attempt < 5; attempt += 1) expect((await start(randomIp())).ok()).toBe(true);
  const blocked = await start(randomIp());
  expect([blocked.status(), Number(blocked.headers()["retry-after"]) > 0]).toEqual([429, true]);
  // Same spoofed prefix, different real address: a separate bucket.
  expect((await start("10.0.0.1", randomIp())).ok()).toBe(true);
});

test("Better Auth's sign-in limit uses the same resolved address", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const spoofed = randomIp();
  const signIn = (real: string) => api.post("/api/auth/sign-in/email", { headers: via(spoofed, real), data: { email: `nobody-${randomUUID()}@example.test`, password: "not the password" } });
  const first = randomIp();
  for (let attempt = 0; attempt < 3; attempt += 1) expect((await signIn(first)).status()).toBe(401);
  expect((await signIn(first)).status()).toBe(429);
  // A different real address behind the same spoofed prefix isn't affected (before, every
  // multi-entry header fell into one shared bucket).
  expect((await signIn(randomIp())).status()).toBe(401);
});

test("production responses ask browsers to use HTTPS only", async ({ request }) => {
  for (const path of ["/", "/login", "/api/health"]) {
    expect((await request.get(`${BASE_URL}${path}`)).headers()["strict-transport-security"]).toBe("max-age=31536000");
  }
});
