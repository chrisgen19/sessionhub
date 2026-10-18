import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { sessionExportSchema } from "@sessionhub/contracts/session-export";
import { BASE_URL } from "../playwright.config";

const groupRef = randomUUID();
const body = (name = "Client Alpha research") => ({
  name,
  windows: [
    {
      groups: [{ id: groupRef, title: "Docs", color: "blue" }],
      tabs: [
        { url: "https://a.test/page", title: "Alpha docs", groupId: groupRef, pinned: false },
        { url: "https://b.test/", title: '<img src=x onerror="window.__pwned=1">', groupId: groupRef },
        { url: "chrome://settings", title: "Settings" },
        { url: "javascript:alert(1)", title: "Evil link" },
      ],
    },
  ],
});

/** Signs up through the auth API (cookies land in the page's context) and creates one session. */
const setup = async (page: Page, name?: string) => {
  const [a, b, c] = randomBytes(3);
  await page.context().setExtraHTTPHeaders({ origin: BASE_URL, "x-forwarded-for": `10.${a}.${b}.${c}` });
  await page.context().route("https://*.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>external</title>" }));
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Detail Tester", email: `detail-${randomUUID()}@example.test`, password: "correct horse battery" },
  });
  expect(signUp.ok()).toBe(true);
  const created = await page.request.post("/api/v1/sessions", { data: body(name) });
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; name: string; version: number };
};

test("list rows open the detail page with a safe window tree", async ({ page }) => {
  const session = await setup(page);
  await page.goto("/app/sessions");
  await page.getByRole("link", { name: /Client Alpha research/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/sessions/${session.id}$`));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Client Alpha research");
  await expect(page.getByText(/From Web · 1 window · 4 tabs · updated .* · version 1/)).toBeVisible();
  const group = page.getByRole("list", { name: "Group Docs" });
  const link = group.getByRole("link", { name: "Alpha docs" });
  await expect(link).toHaveAttribute("href", "https://a.test/page");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");

  await expect(page.getByText('<img src=x onerror="window.__pwned=1">')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  const tree = page.getByRole("region", { name: "Window 1" });
  for (const title of ["Settings", "Evil link"]) {
    await expect(tree.getByText(title, { exact: true })).toBeVisible();
    await expect(tree.getByRole("link", { name: title })).toHaveCount(0);
  }
  await expect(tree.getByText("Won't open")).toHaveCount(2);
  await expect(page.locator("a[href^='javascript:'], a[href^='chrome:']")).toHaveCount(0);

  const response = await page.request.get(`/app/sessions/${session.id}`);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});

test("rename, then a real version conflict is surfaced and resolved by loading the latest", async ({ page }) => {
  const session = await setup(page);
  await page.goto(`/app/sessions/${session.id}`);
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Session name").fill("Renamed in the web app");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renamed in the web app");
  await expect(page.getByText(/version 2$/)).toBeVisible();

  // Someone else (another tab, or later a device) edits version 2 first.
  const elsewhere = await page.request.patch(`/api/v1/sessions/${session.id}`, { data: { expectedVersion: 2, name: "Changed elsewhere" } });
  expect(elsewhere.ok()).toBe(true);

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Session name").fill("My stale edit");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText(/changed somewhere else \(now version 3\)/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renamed in the web app");

  // The form stays open with the user's text so the edit isn't lost.
  await page.getByRole("button", { name: "Load latest version" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changed elsewhere");
  await expect(page.getByLabel("Session name")).toHaveValue("My stale edit");
  await page.getByLabel("Session name").fill("My edit, reapplied");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My edit, reapplied");
  await expect(page.getByText(/version 4$/)).toBeVisible();
});

test("archive moves a session between the active and archived lists", async ({ page }) => {
  const session = await setup(page, "Old project");
  await page.goto(`/app/sessions/${session.id}`);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived. It's hidden from your active sessions.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Archived");

  // A plain URL (a bookmark from before the list rail) opens it beside the archived list, selected.
  await page.goto(`/app/sessions/${session.id}`);
  await expect(page.getByRole("navigation", { name: "Session views" }).getByRole("link", { name: "Archived" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("list", { name: "Saved sessions" }).getByRole("link", { name: /Old project/ })).toHaveAttribute("aria-current", "page");

  await page.goto("/app/sessions");
  await expect(page.getByRole("link", { name: /Old project/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Session views" }).getByRole("link", { name: "Archived" }).click();
  await page.getByRole("link", { name: /Old project/ }).click();
  await page.getByRole("button", { name: "Unarchive" }).click();
  await expect(page.getByText("Moved back to your active sessions.")).toBeVisible();
  await page.goto("/app/sessions");
  await expect(page.getByRole("link", { name: /Old project/ })).toHaveCount(1);
});

test("delete needs confirmation, then the session is gone for good", async ({ page, browser }) => {
  const session = await setup(page);
  await page.goto(`/app/sessions/${session.id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: 'Delete "Client Alpha research"?' });
  await expect(dialog).toContainText("Tabs you have open right now aren't affected, and neither are sessions kept only in a browser.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete session" }).click();
  await expect(page).toHaveURL(/\/app\/sessions$/);
  await expect(page.getByRole("link", { name: /Client Alpha research/ })).toHaveCount(0);
  await page.goto(`/app/sessions/${session.id}`);
  await expect(page.getByText("Session not found")).toBeVisible();
  await page.goto("/app/sessions/not-a-uuid");
  await expect(page.getByText("Session not found")).toBeVisible();

  // Another signed-in user can't open someone else's session page.
  const otherPage = await (await browser.newContext()).newPage();
  const other = await setup(otherPage, "Someone else's");
  await page.goto(`/app/sessions/${other.id}`);
  await expect(page.getByText("Session not found")).toBeVisible();
  await expect(page.getByText("Someone else's")).toHaveCount(0);
});

test("export downloads a valid file and open links opens only web pages, without an opener", async ({ page }) => {
  const session = await setup(page);
  await page.goto(`/app/sessions/${session.id}`);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sessionhub-client-alpha-research-\d{4}-\d{2}-\d{2}\.json$/);
  const file = sessionExportSchema.parse(JSON.parse(await readFile((await download.path())!, "utf8")));
  expect(file.session).toMatchObject({ id: session.id, name: "Client Alpha research" });
  await expect(page.getByText(/Import it in the SessionHub extension/)).toBeVisible();

  await page.getByRole("button", { name: "Open 2 links" }).click();
  const dialog = page.getByRole("dialog", { name: "Open 2 links?" });
  const popups: Page[] = [];
  page.context().on("page", (popup) => popups.push(popup));
  await dialog.getByRole("button", { name: "Open 2 tabs" }).click();
  await expect(page.getByText("Opened 2 links in new tabs.")).toBeVisible();
  await expect.poll(() => popups.length).toBe(2);
  for (const popup of popups) await popup.waitForLoadState();
  expect(popups.map((popup) => popup.url()).sort()).toEqual(["https://a.test/page", "https://b.test/"]);
  expect(await popups[0]!.evaluate(() => window.opener)).toBeNull();
});

test("detail page fits a 375px screen", async ({ page }) => {
  const session = await setup(page, "A session with a really long name that keeps going and going to test wrapping");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/app/sessions/${session.id}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("a session's tags and notes show on its page and in the list, and pinned sessions come first", async ({ page }) => {
  const session = await setup(page, "Tagged research");
  const later = await page.request.post("/api/v1/sessions", { data: body("Newer, not pinned") });
  expect(later.status()).toBe(201);
  const updated = await page.request.patch(`/api/v1/sessions/${session.id}`, {
    data: { expectedVersion: session.version, tags: ["work", "q4"], description: "Read before Friday", isPinned: true },
  });
  expect(updated.ok()).toBe(true);

  await page.goto("/app/sessions");
  const rows = page.getByRole("list", { name: "Saved sessions" }).getByRole("link");
  await expect(rows.first()).toContainText("Pinned: Tagged research");
  await expect(rows.first()).toContainText("work");
  await rows.first().click();
  const details = page.getByRole("article", { name: "Session details" });
  await expect(details.getByText("Read before Friday")).toBeVisible();
  await expect(details.getByText("q4", { exact: true })).toBeVisible();
});
