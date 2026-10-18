import { expect, test } from "@playwright/test";
import { createPrismaClient } from "@sessionhub/database/client";
import { launchWithExtension } from "./extension";
import { randomIp, signUp } from "./pairing-flow";
import { captureAllWindows, connectExtension, readStore, sendCommand, signInProfile, turnOnSync } from "./sync-flow";

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => {
  await prisma.$disconnect();
});

type Stored = { id: string; name: string; version: number; scope: string; sync?: { serverVersion: number | null; state: string } };

test("a session saved in one profile appears in another; edits and deletes follow both ways; pulling opens no tabs", async () => {
  test.setTimeout(120_000);
  // Two separate Chromium profiles with their own extension install: "Windows" and "Mac".
  const windows = await launchWithExtension({ "x-forwarded-for": randomIp() });
  const mac = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(windows.context);
    const onWindows = await connectExtension(windows.context, windows.extensionId);
    await signInProfile(mac.context, email);
    const onMac = await connectExtension(mac.context, mac.extensionId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { devices: true } });
    expect(user.devices).toHaveLength(2);
    const scope = `account:${user.id}`;

    // Windows saves its open tabs, then turns sync on and uploads them from the preview.
    const sessionId = await captureAllWindows(onWindows);
    const session = { id: sessionId };
    await sendCommand(onWindows, { type: "session.rename", sessionId, expectedVersion: 1, name: "Saved on Windows" });
    await turnOnSync(onWindows, windows.extensionId, 1);
    await expect.poll(async () => (await prisma.savedSession.findUnique({ where: { id: sessionId } }))?.name, { timeout: 15_000 }).toBe("Saved on Windows");

    // Every download below must never open, close or navigate a tab.
    const syncWithoutTabChanges = async (profile: typeof mac, manager: typeof onMac) => {
      const before = profile.context.pages().map((page) => page.url());
      const response = await sendCommand(manager, { type: "sync.now" });
      expect(profile.context.pages().map((page) => page.url())).toEqual(before);
      return response;
    };
    const sessionOn = async (manager: typeof onMac) => (await readStore<Stored>(manager, "sessions")).find((stored) => stored.id === session.id);

    // The Mac turns sync on (nothing local to upload) and downloads it into its account scope.
    const macTabs = mac.context.pages().map((page) => page.url());
    await turnOnSync(onMac, mac.extensionId, 0);
    await expect.poll(async () => (await sessionOn(onMac))?.sync?.state, { timeout: 15_000 }).toBe("synced");
    expect(mac.context.pages().map((page) => page.url())).toEqual(macTabs);
    expect(await sessionOn(onMac)).toMatchObject({ name: "Saved on Windows", scope, sync: { serverVersion: 1 } });
    await onMac.goto(`chrome-extension://${mac.extensionId}/manager.html`);
    await expect(onMac.getByRole("button", { name: /Saved on Windows/ })).toContainText("Synced");

    // Renamed on the Mac: the worker uploads it; Windows pulls the new name.
    const macCopy = (await sessionOn(onMac))!;
    expect(await sendCommand(onMac, { type: "session.rename", sessionId: session.id, expectedVersion: macCopy.version, name: "Renamed on the Mac" })).toMatchObject({ ok: true });
    await expect.poll(async () => (await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).name, { timeout: 15_000 }).toBe("Renamed on the Mac");
    await syncWithoutTabChanges(windows, onWindows);
    expect(await sessionOn(onWindows)).toMatchObject({ name: "Renamed on the Mac", sync: { serverVersion: 2, state: "synced" } });

    // Notes, tags and pinned set on the Mac reach Windows; archiving several from Windows reaches the Mac.
    const renamed = (await sessionOn(onMac))!;
    const details = { description: "Read before Friday", tags: ["work", "q4"], isPinned: true };
    expect(await sendCommand(onMac, { type: "session.edit", sessionId: session.id, expectedVersion: renamed.version, ...details })).toMatchObject({ ok: true });
    await expect.poll(async () => (await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).tags, { timeout: 15_000 }).toEqual(["work", "q4"]);
    await syncWithoutTabChanges(windows, onWindows);
    expect(await sessionOn(onWindows)).toMatchObject({ ...details, isArchived: false, sync: { serverVersion: 3, state: "synced" } });
    expect(await sendCommand(onWindows, { type: "session.bulk", sessionIds: [session.id], action: { kind: "archive", archived: true } })).toMatchObject({ ok: true, data: { changed: 1 } });
    await expect.poll(async () => (await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).isArchived, { timeout: 15_000 }).toBe(true);
    await syncWithoutTabChanges(mac, onMac);
    expect(await sessionOn(onMac)).toMatchObject({ ...details, isArchived: true, sync: { serverVersion: 4 } });

    // Deleted on Windows: gone on the Mac after its next sync.
    expect(await sendCommand(onWindows, { type: "session.delete", sessionId: session.id })).toEqual({ ok: true, data: {} });
    await expect.poll(async () => (await prisma.savedSession.findUniqueOrThrow({ where: { id: session.id } })).deletedAt !== null, { timeout: 15_000 }).toBe(true);
    await syncWithoutTabChanges(mac, onMac);
    expect(await sessionOn(onMac)).toBeUndefined();
    await expect(onMac.getByRole("button", { name: /Saved on Windows|Renamed on the Mac/ })).toHaveCount(0);
  } finally {
    await windows.close();
    await mac.close();
  }
});

test("a real conflict between two profiles is reviewed in the extension, and both versions are kept everywhere", async () => {
  test.setTimeout(120_000);
  const windows = await launchWithExtension({ "x-forwarded-for": randomIp() });
  const mac = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(windows.context);
    const onWindows = await connectExtension(windows.context, windows.extensionId);
    await signInProfile(mac.context, email);
    const onMac = await connectExtension(mac.context, mac.extensionId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const sessionId = await captureAllWindows(onWindows);
    await sendCommand(onWindows, { type: "session.rename", sessionId, expectedVersion: 1, name: "Shared plan" });
    await turnOnSync(onWindows, windows.extensionId, 1);
    const server = () => prisma.savedSession.findMany({ where: { userId: user.id, deletedAt: null }, orderBy: { name: "asc" } });
    await expect.poll(async () => (await server()).map((row) => row.name), { timeout: 15_000 }).toEqual(["Shared plan"]);
    await turnOnSync(onMac, mac.extensionId, 0);
    const local = async (manager: typeof onMac, id = sessionId) => (await readStore<Stored>(manager, "sessions")).find((stored) => stored.id === id);
    await expect.poll(async () => (await local(onMac))?.sync?.state, { timeout: 15_000 }).toBe("synced");

    // Both rename it. The Mac's reaches the server first; Windows hasn't pulled it, so its upload conflicts.
    await sendCommand(onMac, { type: "session.rename", sessionId, expectedVersion: (await local(onMac))!.version, name: "Mac's plan" });
    await expect.poll(async () => (await server()).map((row) => row.name), { timeout: 15_000 }).toEqual(["Mac's plan"]);
    await sendCommand(onWindows, { type: "session.rename", sessionId, expectedVersion: (await local(onWindows))!.version, name: "Windows' plan" });
    await expect.poll(async () => (await local(onWindows))?.sync?.state, { timeout: 15_000 }).toBe("conflict");
    await expect.poll(async () => (await readStore(onWindows, "serverCopies")).length, { timeout: 15_000 }).toBe(1);

    // Windows reviews it in the inspector and keeps both.
    await onWindows.goto(`chrome-extension://${windows.extensionId}/manager.html#session=${sessionId}`);
    const inspector = onWindows.getByRole("article", { name: /session details/i });
    await inspector.getByRole("button", { name: "Review…" }).click();
    const dialog = onWindows.getByRole("dialog", { name: `Review "Windows' plan"` });
    await expect(dialog.getByText("Mac's plan")).toBeVisible();
    await dialog.getByRole("button", { name: /^Keep both/ }).click();
    await expect(dialog).toBeHidden();

    // The server has both; the Mac gets both at its next sync, and nothing is waiting anywhere.
    await expect.poll(async () => (await server()).map((row) => row.name), { timeout: 15_000 }).toEqual(["Mac's plan", "Windows' plan (this browser's version)"]);
    expect(await local(onWindows)).toMatchObject({ name: "Mac's plan", sync: { state: "synced" } });
    await sendCommand(onMac, { type: "sync.now" });
    const onMacNames = (await readStore<Stored>(onMac, "sessions")).map((stored) => stored.name).sort();
    expect(onMacNames).toEqual(["Mac's plan", "Windows' plan (this browser's version)"]);
    await expect.poll(async () => (await readStore(onWindows, "outbox")).length, { timeout: 15_000 }).toBe(0);
  } finally {
    await windows.close();
    await mac.close();
  }
});
