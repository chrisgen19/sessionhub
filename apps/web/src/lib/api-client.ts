import { apiErrorResponseSchema, type ApiErrorResponse } from "@sessionhub/contracts/api-sessions";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiErrorResponse["error"] };

/**
 * Same-origin JSON call to /api/v1. The browser adds the Origin header the API requires
 * for writes, and the session cookie authenticates. Never throws.
 */
export const apiFetch = async <T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<ApiResult<T>> => {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: payload as T };
    const parsed = apiErrorResponseSchema.safeParse(payload);
    return {
      ok: false,
      status: response.status,
      error: parsed.success ? parsed.data.error : { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." },
    };
  } catch {
    return { ok: false, status: 0, error: { code: "INTERNAL_ERROR", message: "Couldn't reach SessionHub. Check your connection and try again." } };
  }
};
