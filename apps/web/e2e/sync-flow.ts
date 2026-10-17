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

/** Saves all of this profile's open windows through the worker's command (a test shortcut: the UI saves only ticked tabs). */
export const captureAllWindows = async (manager: Page): Promise<string> => {
  const response = (await sendCommand(manager, { type: "session.capture", scope: { kind: "all-windows" } })) as { ok: boolean; data: { sessionId: string } };
  expect(response.ok).toBe(true);
  return response.data.sessionId;
};

/**
 * Turns sync on through the Account view's real opt-in: opens the upload preview, checks what it
 * lists (every local session ticked), and confirms.
 */
export const turnOnSync = async (manager: Page, extensionId: string, expectListed: number) => {
  await manager.goto(`chrome-extension://${extensionId}/manager.html#view=account`);
  const section = manager.getByRole("region", { name: "Sync" });
  await section.getByRole("button", { name: "Turn on sync…" }).click();
  const dialog = manager.getByRole("dialog", { name: "Turn on sync" });
  if (expectListed === 0) {
    await expect(dialog.getByText("No sessions are saved only in this browser")).toBeVisible();
  } else {
    await expect(dialog.getByRole("list", { name: "Sessions to upload" }).getByRole("checkbox", { checked: true })).toHaveCount(expectListed);
  }
  await dialog.getByRole("button", { name: /^Turn on sync/ }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByText(/^Sync is on\./)).toBeVisible();
};

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
