import type { ApiErrorCode, ApiSessionDetail } from "@sessionhub/contracts/api-sessions";

/** Domain failure with an API error code; the HTTP layer maps it to a status. */
export class SessionServiceError extends Error {
  override name = "SessionServiceError";
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly conflict?: { expectedVersion: number; serverVersion: number; serverState: ApiSessionDetail | null },
  ) {
    super(message);
  }
}

/**
 * Thrown inside a transaction to roll it back while still returning a value (e.g. an
 * idempotent replay). Rolling back keeps the per-user sync sequence free of gaps.
 */
export class RollbackWith<T> extends Error {
  override name = "RollbackWith";
  constructor(readonly value: T) {
    super("rollback");
  }
}
