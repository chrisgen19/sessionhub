import { expect, test } from "@playwright/test";
import type { SavedSession } from "@sessionhub/contracts/session";
import { createPrismaClient } from "@sessionhub/database/client";
import { launchWithExtension } from "./extension";
import { randomIp, signUp } from "./pairing-flow";
import { captureAllWindows, connectExtension, readStore, sendCommand, turnOnSync } from "./sync-flow";

type Stored = SavedSession & { scope: string; sync: { serverVersion: number; state: string } };
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
test.afterAll(async () => { await prisma.$disconnect(); });

test("keeping a rejected edit locally recovers its unchanged account version without uploading the local copy", async () => {
  test.setTimeout(90_000);
  const profile = await launchWithExtension({ "x-forwarded-for": randomIp() });
  try {
    const { email } = await signUp(profile.context);
    const manager = await connectExtension(profile.context, profile.extensionId);
    const id = await captureAllWindows(manager);
    await sendCommand(manager, { type: "session.rename", sessionId: id, expectedVersion: 1, name: "Account original" });
    await turnOnSync(manager, profile.extensionId, 1);
    const account = await prisma.user.findUniqueOrThrow({ where: { email } });
    await expect.poll(async () => (await prisma.savedSession.findUnique({ where: { id } }))?.version, { timeout: 15_000 }).toBe(1);
    await sendCommand(manager, { type: "sync.now" });
    const stored = async () => readStore<Stored>(manager, "sessions");
    await expect.poll(async () => (await stored()).find((session) => session.id === id)?.sync.state, { timeout: 15_000 }).toBe("synced");
    expect((await readStore(manager, "syncState"))[0]?.cursor).toBeTruthy();
    expect(await readStore(manager, "serverCopies")).toEqual([]);

    // Inject a large local edit atomically, as a session editor would. The REAL uploader
    // rejects its >1.5 MB payload; the account version remains unchanged and past the cursor.
    await manager.evaluate(async (sessionId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("sessionhub");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        const current = await new Promise<Stored>((resolve, reject) => {
          const get = db.transaction("sessions").objectStore("sessions").get(sessionId);
          get.onsuccess = () => resolve(get.result as Stored);
          get.onerror = () => reject(get.error);
        });
        const now = new Date().toISOString();
        const first = current.windows[0]!;
        const tabs = Array.from({ length: 220 }, (_, index) => ({ ...first.tabs[0]!, id: crypto.randomUUID(),
          title: `Draft tab ${index}`, url: `https://oversized.example/${"a".repeat(7900)}/${index}`,
          sortOrder: index, pinned: false, groupId: null }));
        const changed: Stored = { ...current, name: "Local draft too large", version: current.version + 1, updatedAt: now,
          windows: [{ ...first, groups: [], tabs }], sync: { serverVersion: current.sync.serverVersion, state: "pending" } };
        const { scope: _scope, sync: _sync, ...payload } = changed;
        const tx = db.transaction(["sessions", "outbox"], "readwrite");
        tx.objectStore("sessions").put(changed);
        tx.objectStore("outbox").add({ id: crypto.randomUUID(), scope: changed.scope, entityType: "savedSession", entityId: sessionId,
          action: "upsert", payload, expectedVersion: current.sync.serverVersion, status: "queued", attempts: 0, nextAttemptAt: null,
          createdAt: now, updatedAt: now, lastError: null });
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
      } finally { db.close(); }
    }, id);
    await sendCommand(manager, { type: "sync.now" });
    expect(await readStore(manager, "outbox")).toMatchObject([{ status: "rejected", lastErrorCode: "TOO_LARGE" }]);
    expect(await readStore(manager, "serverCopies")).toEqual([]);
    expect(await prisma.savedSession.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Account original", version: 1 });

    await manager.goto(`chrome-extension://${profile.extensionId}/manager.html#session=${id}`);
    const otherTabs = () => profile.context.pages().filter((page) => page !== manager).map((page) => page.url());
    const before = otherTabs();
    await manager.getByRole("article", { name: /session details/i }).getByRole("button", { name: "Review…" }).click();
    const dialog = manager.getByRole("dialog", { name: 'Review "Local draft too large"' });
    await dialog.getByRole("button", { name: /^Keep in this browser only/ }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await stored()).map(({ name, scope }) => [name, scope]).sort(), { timeout: 15_000 })
      .toEqual([["Account original", `account:${account.id}`], ["Local draft too large", "local"]]);
    const local = (await stored()).find((session) => session.scope === "local")!;
    expect(local.id).not.toBe(id);
    expect(local.windows[0]?.tabs).toHaveLength(220);
    await expect(manager).toHaveURL(new RegExp(local.id));
    const list = manager.getByRole("list", { name: "Saved sessions" });
    await expect(list.getByRole("button", { name: /^Account original/ })).toContainText("Synced");
    await expect(list.getByRole("button", { name: /^Local draft too large/ })).toContainText("Local only");
    expect(await readStore(manager, "outbox")).toEqual([]);
    expect((await prisma.savedSession.findMany({ where: { userId: account.id } })).map(({ name }) => name)).toEqual(["Account original"]);
    expect(otherTabs()).toEqual(before);
  } finally { await profile.close(); }
});
