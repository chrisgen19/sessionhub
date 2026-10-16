import type { MailAddress, MailTransport } from "./types";

const TIMEOUT_MS = 5_000;

interface MailpitOptions {
  baseUrl: string;
  from: MailAddress;
  fetch?: typeof fetch;
}

/**
 * Development and test transport: Mailpit's HTTP send API (POST /api/v1/send). Messages
 * are caught by Mailpit and shown in its web UI; nothing leaves the machine.
 */
export const createMailpitTransport = ({ baseUrl, from, fetch: fetchImpl = fetch }: MailpitOptions): MailTransport => ({
  name: "mailpit",
  send: async (message) => {
    const response = await fetchImpl(new URL("/api/v1/send", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: from.email, Name: from.name ?? "" },
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Mailpit rejected the message (HTTP ${response.status})`);
  },
});
