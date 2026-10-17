import { expect, test } from "@playwright/test";

// The app's icons are file conventions in src/app (icon.svg, favicon.ico, apple-icon.png), drawn
// from the extension's mark (apps/extension/assets/icon.svg). Public: the proxy only guards /app.
test("every page links the SessionHub icons, and they are served without signing in", async ({ page, request }) => {
  await page.goto("/login");
  const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((elements) =>
    elements.map((element) => `${element.getAttribute("rel")} ${element.getAttribute("type") ?? ""} ${new URL(element.getAttribute("href") ?? "", location.href).pathname}`.trim()),
  );
  expect(links.sort()).toEqual(["apple-touch-icon image/png /apple-icon.png", "icon image/svg+xml /icon.svg", "icon image/x-icon /favicon.ico"]);

  for (const [path, type] of [["/favicon.ico", "image/x-icon"], ["/icon.svg", "image/svg+xml"], ["/apple-icon.png", "image/png"]] as const) {
    const response = await request.get(path);
    expect({ path, status: response.status(), type: response.headers()["content-type"] }).toEqual({ path, status: 200, type });
  }
});
