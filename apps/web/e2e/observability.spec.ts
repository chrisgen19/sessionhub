import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";

const randomIp = () => {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("API and auth responses carry a request id, a proxy's id is kept, and oversized auth bodies are refused", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": randomIp() } });
  const signUp = await api.post("/api/auth/sign-up/email", { data: { name: "Observer", email: `obs-${randomUUID()}@example.test`, password: "correct horse battery" } });
  expect(signUp.headers()["x-request-id"]).toMatch(UUID);

  const list = await api.get("/api/v1/sessions");
  expect([list.status(), UUID.test(list.headers()["x-request-id"] ?? "")]).toEqual([200, true]);
  const fromProxy = await api.get("/api/v1/sessions", { headers: { "x-request-id": "edge-req-0123456789" } });
  expect(fromProxy.headers()["x-request-id"]).toBe("edge-req-0123456789");
  const forged = await api.get("/api/v1/sessions", { headers: { "x-request-id": "<script>alert(1)</script>" } });
  expect(forged.headers()["x-request-id"]).toMatch(UUID);

  // Better Auth never sees a body over 64 KB; normal auth requests still work and are tagged.
  const huge = await api.post("/api/auth/sign-in/email", { data: { email: "a@example.test", password: "x".repeat(70 * 1024) } });
  expect([huge.status(), (await huge.json()).code, UUID.test(huge.headers()["x-request-id"] ?? "")]).toEqual([413, "PAYLOAD_TOO_LARGE", true]);
  const wrong = await api.post("/api/auth/sign-in/email", { data: { email: `nobody-${randomUUID()}@example.test`, password: "not the password" } });
  expect([wrong.status(), UUID.test(wrong.headers()["x-request-id"] ?? "")]).toEqual([401, true]);
});
