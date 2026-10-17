import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";

type Created = { id: string; name: string; version: number };

/** Signs up through the auth API (cookies land in the page's context) and returns REST helpers. */
const setup = async (page: Page) => {
  const [a, b, c] = randomBytes(3);
  await page.context().setExtraHTTPHeaders({ origin: BASE_URL, "x-forwarded-for": `10.${a}.${b}.${c}` });
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Workspace Tester", email: `ws-ui-${randomUUID()}@example.test`, password: "correct horse battery" },
  });
  expect(signUp.ok()).toBe(true);
  const post = async (path: string, data: object): Promise<Created> => {
    const response = await page.request.post(path, { data });
    expect(response.status()).toBe(201);
    return (await response.json()) as Created;
  };
  return {
    workspace: (name: string, color: string | null = null) => post("/api/v1/workspaces", { name, color }),
    session: (name: string, workspaceId: string | null = null) =>
      post("/api/v1/sessions", { name, workspaceId, windows: [{ tabs: [{ url: "https://a.test/", title: "A" }] }] }),
    patch: async (id: string, data: object) => (await page.request.patch(`/api/v1/sessions/${id}`, { data })).json() as Promise<Created & { workspaceId: string | null }>,
  };
};

const rows = (page: Page) => page.getByRole("list", { name: "Saved sessions" }).getByRole("link");

test("the sessions list filters by workspace, keeps the filter across views, and ignores a workspace that isn't yours", async ({ page }) => {
  const api = await setup(page);
  const alpha = await api.workspace("Alpha", "blue");
  const beta = await api.workspace("Beta");
  await api.session("Beta notes", beta.id);
  await api.session("Loose ends");
  const old = await api.session("Old alpha", alpha.id);
  await api.patch(old.id, { expectedVersion: 1, isArchived: true });
  await api.session("Alpha research", alpha.id);

  await page.goto("/app/sessions");
  const filter = page.getByRole("combobox", { name: "Workspace" });
  await expect(filter.getByRole("option")).toHaveText(["All sessions", "Alpha (1)", "Beta (1)", "No workspace (1)"]);
  await expect(rows(page).filter({ hasText: "Alpha research" })).toContainText("Alpha");

  await filter.selectOption(alpha.id);
  await expect(page).toHaveURL(`/app/sessions?workspace=${alpha.id}`);
  await expect(rows(page)).toHaveText([/Alpha research/]);
  await expect(page.getByText("Sessions in “Alpha”.")).toBeVisible();

  await page.getByRole("link", { name: "Archived" }).click();
  await expect(page).toHaveURL(`/app/sessions?view=archived&workspace=${alpha.id}`);
  await expect(rows(page)).toHaveText([/Old alpha/]);
  await filter.selectOption("none");
  await expect(page.getByRole("heading", { name: "No archived sessions in no workspace" })).toBeVisible();

  // Another account's (or a deleted) workspace id filters nothing out.
  await page.goto(`/app/sessions?workspace=${randomUUID()}`);
  await expect(filter).toHaveValue("");
  await expect(rows(page)).toHaveCount(3);
});

test("a session moves between workspaces from its page; a change made elsewhere first is a conflict, never overwritten", async ({ page }) => {
  const api = await setup(page);
  const alpha = await api.workspace("Alpha", "blue");
  const beta = await api.workspace("Beta");
  const session = await api.session("Research");

  await page.goto(`/app/sessions/${session.id}`);
  const select = page.getByRole("combobox", { name: "Workspace" });
  await expect(select).toHaveValue("");
  await select.selectOption(alpha.id);
  await expect(page.getByText(/version 2$/)).toBeVisible();
  // The notice survives the refresh that brings the new version.
  await expect(page.getByText("Moved to “Alpha”.")).toBeVisible();

  // Renamed elsewhere (version 3) while this page still has version 2.
  expect(await api.patch(session.id, { expectedVersion: 2, name: "Renamed elsewhere" })).toMatchObject({ version: 3, workspaceId: alpha.id });
  await select.selectOption(beta.id);
  await expect(page.getByText(/changed somewhere else \(now version 3\)/)).toBeVisible();
  await expect(select).toHaveValue(alpha.id);
  await page.getByRole("button", { name: "Load latest version" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renamed elsewhere");
  await page.getByRole("combobox", { name: "Workspace" }).selectOption(beta.id);
  await expect(page.getByText("Moved to “Beta”.")).toBeVisible();

  await page.goto(`/app/sessions?workspace=${beta.id}`);
  await expect(rows(page)).toHaveText([/Renamed elsewhere/]);
  await page.goto(`/app/sessions/${session.id}`);
  await page.getByRole("combobox", { name: "Workspace" }).selectOption("");
  await expect(page.getByText("Moved out of its workspace.")).toBeVisible();
});

test("without workspaces there is no filter, and the session page says where to create them", async ({ page }) => {
  const api = await setup(page);
  const session = await api.session("Solo");
  await page.goto("/app/sessions");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Workspace" })).toHaveCount(0);
  await page.goto(`/app/sessions/${session.id}`);
  await expect(page.getByText(/No workspaces yet\. Create them in the SessionHub extension/)).toBeVisible();
});

test("filter and assignment fit a 390px screen", async ({ page }) => {
  const api = await setup(page);
  const workspace = await api.workspace("A workspace with a rather long name for a phone screen", "green");
  const session = await api.session("A session with a long name that needs to wrap on a small screen", workspace.id);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app/sessions", `/app/sessions?workspace=${workspace.id}`, `/app/sessions/${session.id}`]) {
    await page.goto(path);
    await expect(page.getByRole("combobox", { name: "Workspace" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});
