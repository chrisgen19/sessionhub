import { SESSION_LIMITS, type RestoreEligibility } from "@sessionhub/contracts/session";

/** Bump when classification rules change so stored decisions can be re-evaluated. */
export const URL_CLASSIFIER_VERSION = 1;

export interface UrlClassification {
  eligibility: RestoreEligibility;
  /** User-readable explanation; null when the URL is restorable. */
  reason: string | null;
}

const BROWSER_INTERNAL_SCHEMES = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "chrome-search:",
  "devtools:",
  "edge:",
  "brave:",
  "opera:",
  "vivaldi:",
  "about:",
  "view-source:",
]);

const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "blob:", "vbscript:"]);

const REASONS: Record<Exclude<RestoreEligibility, "restorable">, string> = {
  "browser-internal": "Browser pages can't be reopened by extensions",
  "local-file": "Local files aren't restored",
  unsafe: "Blocked for safety",
  unsupported: "Unsupported link type",
  invalid: "Not a valid link",
};

/** Human-readable explanation for a stored eligibility value. */
export const describeEligibility = (eligibility: RestoreEligibility): string | null =>
  eligibility === "restorable" ? null : REASONS[eligibility];

/**
 * Classifies a tab URL for capture/restore (docs/SECURITY_PRIVACY.md section 3).
 * Only plain http(s) pages are restorable; everything else is kept as metadata
 * so a window is never silently dropped, but it is never navigated to.
 */
export const classifyUrl = (rawUrl: string): UrlClassification => {
  const verdict = (eligibility: RestoreEligibility): UrlClassification => ({
    eligibility,
    reason: describeEligibility(eligibility),
  });

  if (rawUrl.length === 0 || rawUrl.length > SESSION_LIMITS.urlMax) {
    return verdict("invalid");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return verdict("invalid");
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme === "http:" || scheme === "https:") {
    return parsed.hostname.length > 0 ? verdict("restorable") : verdict("invalid");
  }
  if (BROWSER_INTERNAL_SCHEMES.has(scheme)) return verdict("browser-internal");
  if (scheme === "file:") return verdict("local-file");
  if (UNSAFE_SCHEMES.has(scheme)) return verdict("unsafe");
  return verdict("unsupported");
};

/** Short display form (hostname + path) for list rows; falls back to the raw string. */
export const displayUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return rawUrl;
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return rawUrl;
  }
};
