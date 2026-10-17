/**
 * Log redaction (docs/SECURITY_PRIVACY.md section 7): logs never carry URLs, email addresses,
 * tokens, request bodies or session content. Applied by the logger to every field, so a careless
 * call site can't leak them either.
 */

const TOKEN = /\bshd_(?:at|rt|dc)_[A-Za-z0-9_-]+|\bBearer\s+\S+/gi;
/** Anything with a scheme, plus bare "www." hosts. */
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*|\b(?:javascript|data|blob|mailto|about|file|chrome|chrome-extension):[^\s"'<>]*|\bwww\.[^\s"'<>]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Field names whose values are dropped whatever they contain. */
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|passwd|url|uri|link|href|email|title|name|payload|body|query|cursor/i;
const MAX_TEXT = 300;

export const redactText = (text: string): string =>
  text.replace(TOKEN, "[token]").replace(URL_LIKE, "[url]").replace(EMAIL, "[email]").slice(0, MAX_TEXT);

/**
 * A request path that is safe to log: no query or fragment, and every segment that could identify
 * something (UUIDs, long or opaque segments, numbers) replaced with `:id`, e.g. `/api/v1/sessions/:id`.
 */
export const redactPath = (url: string): string => {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return "[unparseable]";
  }
  return pathname
    .split("/")
    .map((segment) => (segment === "" || /^[a-z][a-z-]{0,23}$/.test(segment) || /^v\d$/.test(segment) ? segment : ":id"))
    .join("/");
};

export type LogValue = string | number | boolean | null | undefined;

/** Copies log fields, dropping sensitive keys and scrubbing every string. */
export const redactFields = (fields: Record<string, LogValue>): Record<string, LogValue> => {
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safe[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : typeof value === "string" ? redactText(value) : value;
  }
  return safe;
};
