import type { ApiErrorCode, ApiErrorResponse } from "@sessionhub/contracts/api-sessions";

/** Domain failure with an API error code; the HTTP layer maps it to a status. */
export class ServiceError extends Error {
  override name = "ServiceError";
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** Extra error fields, e.g. a version conflict's server state. */
    readonly details: Omit<ApiErrorResponse["error"], "code" | "message"> = {},
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
