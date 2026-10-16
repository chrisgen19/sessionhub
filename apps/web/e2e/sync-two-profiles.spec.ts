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
