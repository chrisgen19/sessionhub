"use client";

import type { ApiSessionDetail } from "@sessionhub/contracts/api-sessions";
import { SESSION_LIMITS } from "@sessionhub/contracts/session";
import { useState, type FormEvent } from "react";
import { apiFetch, type ApiResult } from "@/lib/api-client";

interface RenameFormProps {
  detail: ApiSessionDetail;
  pending: boolean;
  run: (request: () => Promise<ApiResult<ApiSessionDetail>>, onSuccess: (data: ApiSessionDetail) => string | null) => Promise<boolean>;
  onDone: () => void;
}

export function RenameForm({ detail, pending, run, onDone }: RenameFormProps) {
  const [name, setName] = useState(detail.name);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name.");
    if (trimmed === detail.name) return onDone();
    const ok = await run(
      () => apiFetch<ApiSessionDetail>(`/api/v1/sessions/${detail.id}`, "PATCH", { expectedVersion: detail.version, name: trimmed }),
      () => "Renamed.",
    );
    if (ok) onDone();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-start gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Session name</span>
        <input
          autoFocus
          value={name}
          maxLength={SESSION_LIMITS.nameMax}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDone();
          }}
          aria-invalid={error ? true : undefined}
          className="h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm"
        />
        {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
      </label>
      <button type="submit" disabled={pending} className="h-9 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60">
        Save name
      </button>
      <button type="button" onClick={onDone} className="h-9 rounded-lg border border-line px-3.5 text-[13px] font-semibold hover:bg-surface-muted">
        Cancel
      </button>
    </form>
  );
}
