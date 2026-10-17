import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { redactFields, redactText, type LogValue } from "./redact";

/**
 * Structured logs: one JSON object per line on stdout (info) or stderr (warn, error), which the
 * container platform collects. Every entry carries the request id when there is one, and every
 * field goes through redaction (no URLs, emails, tokens or content).
 */

export type LogLevel = "info" | "warn" | "error";

interface RequestContext {
  requestId: string;
}

const context = new AsyncLocalStorage<RequestContext>();

/** A proxy's request id is kept when it looks like one; anything else gets a fresh UUID. */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
/** Device credential prefixes anywhere in it: the id is logged unredacted, so one is never kept. */
const CREDENTIAL = /shd_(?:at|rt|dc)_/i;

export const requestIdFor = (request: Request): string => {
  const incoming = request.headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) && !CREDENTIAL.test(incoming) ? incoming : randomUUID();
};

/** Runs `fn` with this request id attached to every log line written inside it. */
export const withRequestId = <T>(requestId: string, fn: () => T): T => context.run({ requestId }, fn);

export const currentRequestId = (): string | null => context.getStore()?.requestId ?? null;

type Sink = (level: LogLevel, line: string) => void;

const defaultSink: Sink = (level, line) => (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
let sink: Sink = defaultSink;

/** Tests only: capture log lines instead of writing them. Returns a restore function. */
export const captureLogs = (capture: Sink): (() => void) => {
  sink = capture;
  return () => {
    sink = defaultSink;
  };
};

/** Writes one structured entry. `event` is a short snake_case name; fields are redacted. */
export const log = (level: LogLevel, event: string, fields: Record<string, LogValue> = {}): void => {
  const entry = { time: new Date().toISOString(), level, event, requestId: currentRequestId() ?? undefined, ...redactFields(fields) };
  sink(level, JSON.stringify(entry));
};

/** An error as safe fields: its class, and its message only after redaction. */
export const errorFields = (error: unknown): Record<string, LogValue> =>
  error instanceof Error ? { errorClass: error.name, errorMessage: redactText(error.message) } : { errorClass: typeof error };
