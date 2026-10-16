import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { openAccountView, startConnect } from "./pairing-flow";

/** Shared steps for driving real extensions through sync against the E2E server. */

/** Signs in to an existing account in this profile (the password `signUp` uses). */
export const signInProfile = async (context: BrowserContext, email: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return page;
};

/** Connects this profile's extension to the account signed in on the web and returns its manager page. */
export const connectExtension = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const manager = await openAccountView(context, extensionId);
  const { tab } = await startConnect(context, manager);
  await tab.getByRole("button", { name: "Connect this browser" }).click();
  await expect(manager.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });
  return manager;
};

/** A valid local session record, as the extension stores it. */
export const localSession = (name: string) => {
  const now = new Date().toISOString();
  const tab = (url: string, sortOrder: number) => ({ id: randomUUID(), title: url, url, pinned: false, sortOrder, groupId: null, eligibility: "restorable" });
  return {
    id: randomUUID(),
    schemaVersion: 1,
    name,
    createdAt: now,
    updatedAt: now,
    sourceDeviceId: randomUUID(),
    sourceDeviceName: "This browser",
    version: 1,
    windows: [{ id: randomUUID(), sortOrder: 0, groups: [], tabs: [tab("https://a.test/", 0), tab("https://b.test/", 1)] }],
  };
};

/**
 * Stand-in for the opt-in and upload preview (a later slice): turns sync on for the account in this
 * profile and, given a session, places it in the account's scope with a queued create.
 */
export const enableSync = (manager: Page, scope: string, session?: ReturnType<typeof localSession>) =>
  manager.evaluate(
    ({ scope, session, operationId, now }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("sessionhub");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(["sessions", "outbox", "syncState"], "readwrite");
          if (session) {
            tx.objectStore("sessions").put({ ...session, scope, sync: { serverVersion: null, state: "pending" } });
            tx.objectStore("outbox").add({ id: operationId, scope, entityType: "savedSession", entityId: session.id, action: "upsert", expectedVersion: 0, payload: session, status: "queued", createdAt: now, updatedAt: now, attempts: 0, nextAttemptAt: null, lastError: null });
          }
          tx.objectStore("syncState").put({ scope, enabledAt: now, cursor: null, lastSyncAt: null, lastError: null, failures: 0, nextAttemptAt: null });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { scope, session: session ?? null, operationId: randomUUID(), now: new Date().toISOString() },
  );

/** Sends a worker command from an extension page, as the extension's own pages do. */
export const sendCommand = (manager: Page, command: object): Promise<unknown> => manager.evaluate((message) => chrome.runtime.sendMessage(message), command);

/** Every record of one of the extension's IndexedDB stores. */
export const readStore = <T = Record<string, unknown>>(manager: Page, store: string): Promise<T[]> =>
  manager.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("sessionhub");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction(name).objectStore(name).getAll();
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            open.result.close();
            resolve(read.result as T[]);
          };
        };
      }),
    store,
  );
