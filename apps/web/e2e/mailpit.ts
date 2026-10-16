import { expect, request } from "@playwright/test";

/** Mailpit from infra/docker/compose.dev.yaml (or the CI service). */
export const MAILPIT_URL = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:58025";

interface MailpitSummary {
  ID: string;
  Subject: string;
}

const search = async (to: string): Promise<MailpitSummary[]> => {
  const api = await request.newContext({ baseURL: MAILPIT_URL });
  const response = await api.get("/api/v1/search", { params: { query: `to:"${to}"` } });
  expect(response.ok()).toBe(true);
  const { messages } = (await response.json()) as { messages: MailpitSummary[] };
  await api.dispose();
  return messages;
};

/** Every message sent to `to`, newest first. */
export const listEmails = search;

/** Waits for a message to `to` whose subject matches, and returns its text body and first link. */
export const waitForEmail = async (to: string, subject: RegExp, { count = 1 } = {}) => {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const matching = (await search(to)).filter((message) => subject.test(message.Subject));
        found = matching[0];
        return matching.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(count);
  const api = await request.newContext({ baseURL: MAILPIT_URL });
  const message = (await (await api.get(`/api/v1/message/${found!.ID}`)).json()) as { Text: string; HTML: string; From: { Address: string } };
  await api.dispose();
  const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
  return { ...message, link };
};
