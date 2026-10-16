import { AlertTriangle, Camera, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { MasterDetail } from "../../components/master-detail";
import { buttonClass } from "../../components/modal";
import { useRecovery } from "../../hooks/use-recovery";
import { formatListDate } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";
import { CheckpointInspector } from "./checkpoint-inspector";
import { CheckpointList } from "./checkpoint-list";

const RESULT_TEXT = { created: "Checkpoint saved.", unchanged: "Nothing changed since the last checkpoint.", empty: "No tabs to save.", clean: "" };

export function RecoveryView({ snapshotId, onSelect }: { snapshotId: string | null; onSelect: (id: string | null) => void }) {
  const { data, retry } = useRecovery();
  const [taking, setTaking] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const selected = data.status === "ready" ? data.snapshots.find((snapshot) => snapshot.id === snapshotId) : undefined;

  const takeNow = async () => {
    setTaking(true);
    const response = await sendCommand({ type: "recovery.checkpointNow" });
    setTaking(false);
    setNotice(response.ok ? { tone: "ok", text: RESULT_TEXT[response.data.status] } : { tone: "error", text: response.error.message });
  };

  const list = (
    <>
      <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Recovery</h1>
          <button type="button" className={buttonClass.secondary} disabled={taking} onClick={() => void takeNow()}>
            {taking ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Camera aria-hidden="true" className="size-4" />}
            Checkpoint now
          </button>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-fg-muted">
          SessionHub automatically saves your open windows shortly after they change. Checkpoints stay on this computer and are
          never uploaded. They keep tab links and groups, not page content, form data or sign-ins.
        </p>
        <div aria-live="polite" className="space-y-1 text-xs">
          {data.status === "ready" && data.state.lastSnapshotAt && (
            <p className="text-fg-muted">Last checkpoint: {formatListDate(data.state.lastSnapshotAt)}</p>
          )}
          {data.status === "ready" && data.state.lastError && (
            <p className="flex items-center gap-1.5 text-warning">
              <AlertTriangle aria-hidden="true" className="size-3.5" /> Last automatic checkpoint failed: {data.state.lastError}
            </p>
          )}
          {notice && <p className={notice.tone === "ok" ? "text-brand" : "text-danger"}>{notice.text}</p>}
        </div>
      </header>
      {data.status === "loading" && <div aria-busy="true" aria-label="Loading checkpoints" className="m-4 h-14 animate-pulse rounded-lg bg-surface-muted" />}
      {data.status === "error" && (
        <p role="alert" className="m-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Checkpoint storage unavailable: {data.message}. Your saved sessions aren't affected; export any you need.{" "}
          <button type="button" className="font-semibold underline" onClick={retry}>Retry</button>
        </p>
      )}
      {data.status === "ready" && data.snapshots.length === 0 && (
        <div className="m-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
          <p className="text-[13px] font-semibold">Automatic checkpoints appear as you browse</p>
          <p className="mt-1 text-xs text-fg-muted">The first one is saved shortly after you open, close or move tabs.</p>
        </div>
      )}
      {data.status === "ready" && data.snapshots.length > 0 && (
        <CheckpointList snapshots={data.snapshots} selectedId={snapshotId} onSelect={onSelect} />
      )}
    </>
  );

  return (
    <MasterDetail
      label="Recovery checkpoints"
      list={list}
      emptyDetail="Select a checkpoint to see what was open."
      detail={selected ? <CheckpointInspector snapshot={selected} onBack={() => onSelect(null)} /> : null}
    />
  );
}
