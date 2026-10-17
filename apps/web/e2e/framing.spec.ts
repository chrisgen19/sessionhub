import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { randomIp, signUp } from "./pairing-flow";

const NO_FRAMING = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };

test("every page and API response forbids framing", async ({ request }) => {
  for (const path of ["/", "/login", "/signup", "/reset-password", "/app/pair?code=BCDF-GHJK", "/api/health", "/api/v1/sessions"]) {
    const headers = (await request.get(`${BASE_URL}${path}`)).headers();
    expect({ path, csp: headers["content-security-policy"], xfo: headers["x-frame-options"] }).toEqual({
      path,
      csp: NO_FRAMING["content-security-policy"],
      xfo: NO_FRAMING["x-frame-options"],
    });
  }
});

test("the approve page can't be framed, even by this site with the session cookie, so Connect can't be clickjacked", async ({ browser, playwright }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const { page } = await signUp(context);
  // A real pending request, started the way the extension starts one.
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  const started = (await (await api.post("/api/v1/pairing", { data: { installationId: randomUUID(), deviceName: "Framed Chrome", browser: "Chrome" } })).json()) as {
    verificationUriComplete: string;
  };

  // Opened directly, the page offers to connect the browser.
  await page.goto(started.verificationUriComplete);
  await expect(page.getByRole("button", { name: "Connect this browser" })).toBeVisible();

  // Embedded by a page on this same origin (so the session cookie is sent), the browser refuses to
  // render it: the frame ends on Chrome's error page instead of the approve page.
  await page.route(`${BASE_URL}/framing-test`, (route) =>
    route.fulfill({ contentType: "text/html", body: `<iframe src="${started.verificationUriComplete}" width="800" height="600"></iframe>` }),
  );
  await page.goto(`${BASE_URL}/framing-test`);
  await expect.poll(() => page.frames().find((frame) => frame !== page.mainFrame())?.url() ?? "").toMatch(/^chrome-error:\/\//);
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Connect this browser" })).toHaveCount(0);
  await context.close();
});
