import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { BASE_URL } from "../playwright.config";
import { launchWithExtension } from "./extension";
import { randomIp, signUp } from "./pairing-flow";
import { captureAllWindows, connectExtension, readStore, sendCommand, signInProfile, turnOnSync } from "./sync-flow";

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

type StoredWorkspace = { id: string; name: string; color: string | null; scope: string; deletedAt: string | null; sync: { serverVersion: number | null; state: string } };
type StoredSession = { id: string; scope: string; workspaceId?: string | null };

/** Syncs one profile and checks that downloading never opened, closed or navigated a tab. */
const syncWithoutTabChanges = async (context: BrowserContext, manager: Page) => {
  const before = context.pages().map((page) => page.url());
  expect(await sendCommand(manager, { type: "sync.now" })).toMatchObject({ ok: true, data: { pull: { status: "done" } } });
  expect(context.pages().map((page) => page.url())).toEqual(before);
};

const workspacesOn = async (manager: Page) => (await readStore<StoredWorkspace>(manager, "workspaces")).filter((workspace) => !workspace.deletedAt);

test("workspaces and assignments follow between two profiles and the web; edits merge per field; deleting moves sessions out", async () => {
  test.setTimeout(150_000);
  const windows = await launchWithExtension({ "x-forwarded-for": randomIp() });
  const mac = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(windows.context);
    const onWindows = await connectExtension(windows.context, windows.extensionId);
    await signInProfile(mac.context, email);
    const onMac = await connectExtension(mac.context, mac.extensionId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const scope = `account:${user.id}`;

    // A workspace made on the web reaches Windows with its first sync.
    const fromWeb = await (await windows.context.request.post(`${BASE_URL}/api/v1/workspaces`, { headers: { origin: BASE_URL }, data: { name: "Made on the web", color: "purple" } })).json();
    const sessionId = await captureAllWindows(onWindows);
    await sendCommand(onWindows, { type: "session.rename", sessionId, expectedVersion: 1, name: "Saved on Windows" });
    await turnOnSync(onWindows, windows.extensionId, 1);
    await expect.poll(async () => (await workspacesOn(onWindows)).map((workspace) => workspace.name), { timeout: 15_000 }).toEqual(["Made on the web"]);

    // Windows creates a workspace and puts the session in it, through the manager UI.
    await onWindows.goto(`chrome-extension://${windows.extensionId}/manager.html`);
    await onWindows.getByRole("button", { name: "Manage workspaces" }).click();
    const dialog = onWindows.getByRole("dialog", { name: "Workspaces" });
    await dialog.getByRole("textbox", { name: "Workspace name" }).fill("Client Alpha");
    await dialog.getByRole("combobox", { name: "Color" }).selectOption("blue");
    await dialog.getByRole("button", { name: "Add workspace" }).click();
    await expect(dialog.getByRole("list", { name: "Your workspaces" })).toContainText("Client Alpha");
    await dialog.getByRole("button", { name: "Close" }).click();
    const alpha = (await workspacesOn(onWindows)).find((workspace) => workspace.name === "Client Alpha")!;
    await onWindows.getByRole("combobox", { name: "Workspace" }).selectOption("");
    await onWindows.getByRole("button", { name: /Saved on Windows/ }).click();
    await onWindows.getByRole("article", { name: /session details/i }).getByRole("combobox", { name: "Workspace" }).selectOption(alpha.id);
    await expect.poll(async () => (await prisma.savedSession.findUniqueOrThrow({ where: { id: sessionId } })).workspaceId, { timeout: 15_000 }).toBe(alpha.id);
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: alpha.id } })).toMatchObject({ userId: user.id, name: "Client Alpha", color: "blue" });

    // The Mac turns sync on: both workspaces and the assignment arrive, and its switcher filters by them.
    const macTabs = mac.context.pages().map((page) => page.url());
    await turnOnSync(onMac, mac.extensionId, 0);
    await expect.poll(async () => (await readStore<StoredSession>(onMac, "sessions")).find((stored) => stored.id === sessionId)?.workspaceId, { timeout: 15_000 }).toBe(alpha.id);
    expect(mac.context.pages().map((page) => page.url())).toEqual(macTabs);
    expect((await workspacesOn(onMac)).map((workspace) => [workspace.name, workspace.scope]).sort()).toEqual([["Client Alpha", scope], ["Made on the web", scope]]);
    await onMac.goto(`chrome-extension://${mac.extensionId}/manager.html#workspace=${alpha.id}`);
    await expect(onMac.getByRole("combobox", { name: "Workspace" })).toHaveValue(alpha.id);
    await expect(onMac.getByRole("list", { name: "Saved sessions" }).getByRole("button")).toHaveCount(1);

    // Edited on both: the Mac's color and Windows' name both survive (per-field merge).
    expect(await sendCommand(onMac, { type: "workspace.update", workspaceId: alpha.id, color: "red" })).toMatchObject({ ok: true });
    await expect.poll(async () => (await prisma.workspace.findUniqueOrThrow({ where: { id: alpha.id } })).color, { timeout: 15_000 }).toBe("red");
    expect(await sendCommand(onWindows, { type: "workspace.update", workspaceId: alpha.id, name: "Client Alpha (renamed)" })).toMatchObject({ ok: true });
    await expect.poll(async () => (await prisma.workspace.findUniqueOrThrow({ where: { id: alpha.id } })).name, { timeout: 15_000 }).toBe("Client Alpha (renamed)");
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: alpha.id } })).toMatchObject({ color: "red", version: 3 });
    await syncWithoutTabChanges(windows.context, onWindows);
    await syncWithoutTabChanges(mac.context, onMac);
    for (const manager of [onWindows, onMac]) {
      expect((await workspacesOn(manager)).find((workspace) => workspace.id === alpha.id)).toMatchObject({ name: "Client Alpha (renamed)", color: "red", sync: { serverVersion: 3, state: "synced" } });
    }

    // Windows deletes it through the dialog: the session moves out first, then the workspace goes everywhere.
    await onWindows.getByRole("button", { name: "Manage workspaces" }).click();
    await dialog.getByRole("button", { name: "Delete Client Alpha (renamed)" }).click();
    await expect(dialog.getByText(/Its 1 session moves to No workspace\. No session is deleted and no tabs close/)).toBeVisible();
    await dialog.getByRole("button", { name: "Delete workspace" }).click();
    await expect.poll(async () => (await prisma.workspace.findUniqueOrThrow({ where: { id: alpha.id } })).deletedAt !== null, { timeout: 15_000 }).toBe(true);
    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ workspaceId: null, deletedAt: null });

    // Deleted on the web too: both profiles drop both workspaces; the session stays.
    const removed = await windows.context.request.delete(`${BASE_URL}/api/v1/workspaces/${fromWeb.id}?expectedVersion=1`, { headers: { origin: BASE_URL } });
    expect(removed.ok()).toBe(true);
    for (const [context, manager] of [[windows.context, onWindows], [mac.context, onMac]] as const) {
      await syncWithoutTabChanges(context, manager);
      expect(await workspacesOn(manager)).toEqual([]);
      expect((await readStore<StoredSession>(manager, "sessions")).find((stored) => stored.id === sessionId)).toMatchObject({ workspaceId: null });
    }
  } finally {
    await windows.close();
    await mac.close();
  }
});
