import { browser } from "wxt/browser";
import type { Command, CommandResponse } from "./messages";

/** Sends a command to the background worker and returns its typed response. */
export const sendCommand = async <C extends Command>(command: C): Promise<CommandResponse<C["type"]>> => {
  try {
    const response = (await browser.runtime.sendMessage(command)) as CommandResponse<C["type"]> | undefined;
    return response ?? { ok: false, error: { code: "browser-error", message: "SessionHub didn't respond. Try again." } };
  } catch (error) {
    return {
      ok: false,
      error: { code: "browser-error", message: error instanceof Error ? error.message : "Couldn't reach SessionHub" },
    };
  }
};
