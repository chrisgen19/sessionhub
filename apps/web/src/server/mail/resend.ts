import { formatAddress, type MailAddress, type MailTransport } from "./types";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

interface ResendOptions {
  apiKey: string;
  from: MailAddress;
  fetch?: typeof fetch;
}

/**
 * Resend's REST API (POST /emails) over plain fetch, so no SDK dependency.
 * Errors carry only the HTTP status: never the API key, recipient or response body.
 */
export const createResendTransport = ({ apiKey, from, fetch: fetchImpl = fetch }: ResendOptions): MailTransport => ({
  name: "resend",
  send: async (message) => {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: formatAddress(from), to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Resend rejected the message (HTTP ${response.status})`);
  },
});
