"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/sessions/confirm-dialog";
import { apiFetch } from "@/lib/api-client";

/** Disconnects one device after confirmation; its local sessions are never touched. */
export function RevokeDeviceButton({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setBusy(true);
    const result = await apiFetch(`/api/v1/devices/${deviceId}/revoke`, "POST");
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="h-8 rounded-lg border border-line px-3 text-xs font-semibold text-danger hover:bg-danger-soft"
      >
        Disconnect
      </button>
      {open && (
        <ConfirmDialog title={`Disconnect "${deviceName}"?`} confirmLabel="Disconnect" tone="danger" busy={busy} onConfirm={() => void revoke()} onClose={() => setOpen(false)}>
          <p>That browser can&apos;t use your account any more until someone connects it again from the extension.</p>
          <p>Sessions saved in the extension on that computer stay there. Nothing is deleted.</p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
