import { after } from "next/server";
import { getMailConfig, type MailConfig } from "../env";
import { createMailpitTransport } from "./mailpit";
import { createResendTransport } from "./resend";
import type { MailMessage, MailTransport } from "./types";

const createTransport = (config: MailConfig): MailTransport | null => {
  switch (config.transport) {
    case "resend":
      return createResendTransport({ apiKey: config.resendApiKey, from: config.from });
    case "mailpit":
      return createMailpitTransport({ baseUrl: config.mailpitUrl, from: config.from });
    case "disabled":
      return null;
  }
};

let transport: MailTransport | null | undefined;

const getTransport = (): MailTransport | null => {
  if (transport === undefined) transport = createTransport(getMailConfig());
  return transport;
};

/** Whether this server can send email (password reset and verification depend on it). */
export const isMailEnabled = (): boolean => getMailConfig().transport !== "disabled";

const send = async (message: MailMessage): Promise<void> => {
  const active = getTransport();
  if (!active) return;
  try {
    await active.send(message);
  } catch (error) {
    // Error class and status only: never the recipient, link or token.
    console.error(`Email delivery via ${active.name} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
};

/**
 * Sends after the response is finished (Next.js `after`), so auth responses take the
 * same time whether or not an account exists and a slow provider never delays them.
 * Outside a request scope (scripts, tests calling auth.api directly) it sends in the background.
 */
export const queueMail = (message: MailMessage): void => {
  try {
    after(() => send(message));
  } catch {
    void send(message);
  }
};

/** Test hook: forget the cached transport after the environment changes. */
export const resetMailTransportForTests = (): void => {
  transport = undefined;
};
