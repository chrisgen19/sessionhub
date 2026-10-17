const QUOTA_NAME = "QuotaExceededError";
/** Legacy DOMException code for QUOTA_EXCEEDED_ERR. */
const QUOTA_CODE = 22;

/**
 * True when an error (or anything it wraps) is a storage quota failure. Dexie maps the
 * DOM error to `Dexie.QuotaExceededError` (original in `inner`), a failed transaction
 * may surface as an `AbortError` wrapping it, and bulk operations collect `failures`.
 */
export const isQuotaError = (error: unknown, depth = 0): boolean => {
  if (depth > 5 || typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown; inner?: unknown; cause?: unknown; failures?: unknown };
  if (candidate.name === QUOTA_NAME) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && candidate.code === QUOTA_CODE) return true;
  const failures = Array.isArray(candidate.failures) ? candidate.failures : [];
  return [candidate.inner, candidate.cause, ...failures].some((nested) => isQuotaError(nested, depth + 1));
};

export const STORAGE_FULL_HINT = "Delete or export sessions you no longer need, then try again.";

/** Thrown when storage fills up after a restore had already opened tabs it could not record. */
export class RestoreRecordingError extends Error {
  override name = "RestoreRecordingError";
  constructor() {
    super(
      "Storage for SessionHub is full, so it stopped and couldn't record which tabs opened. Check your new windows before retrying.",
    );
  }
}
