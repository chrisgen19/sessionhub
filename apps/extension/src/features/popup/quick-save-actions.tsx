import { AppWindow, Layers, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { CaptureReport } from "@sessionhub/core/capture";
import { plural } from "../../lib/format";
import { sendCommand } from "../../lib/message-client";

type SaveScope = "window" | "all-windows";
type SaveState =
  | { status: "idle" }
  | { status: "saving"; scope: SaveScope }
  | { status: "saved"; report: CaptureReport }
  | { status: "error"; scope: SaveScope; message: string };

const savedMessage = (report: CaptureReport) => {
  const skipped = Object.values(report.notRestorable).reduce((sum, count) => sum + count, 0);
  const base = `Saved locally: ${plural(report.tabCount, "tab")} in ${plural(report.windowCount, "window")}.`;
  return skipped > 0 ? `${base} ${plural(skipped, "browser page")} saved as reference only.` : base;
};

/** The popup's two primary actions. Saving never waits on the network. */
export function QuickSaveActions() {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [windowCount, setWindowCount] = useState<number | null>(null);

  useEffect(() => {
    void browser.windows
      .getAll({ windowTypes: ["normal"] })
      .then((windows) => setWindowCount(windows.filter((window) => !window.incognito).length))
      .catch(() => setWindowCount(null));
  }, []);

  const save = async (scope: SaveScope) => {
    setState({ status: "saving", scope });
    let windowId: number | undefined;
    if (scope === "window") {
      windowId = (await browser.windows.getCurrent().catch(() => undefined))?.id;
      if (windowId === undefined) {
        setState({ status: "error", scope, message: "Couldn't find this window. Try again." });
        return;
      }
    }
    const response = await sendCommand({
      type: "session.capture",
      scope: windowId === undefined ? { kind: "all-windows" } : { kind: "window", windowId },
    });
    setState(
      response.ok
        ? { status: "saved", report: response.data.report }
        : { status: "error", scope, message: response.error.message },
    );
  };

  const busy = state.status === "saving";
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("window")}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          {busy && state.scope === "window" ? <Spinner /> : <AppWindow aria-hidden="true" className="size-4" />}
          Save window
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("all-windows")}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface-muted disabled:opacity-60"
        >
          {busy && state.scope === "all-windows" ? <Spinner /> : <Layers aria-hidden="true" className="size-4" />}
          Save all{windowCount !== null ? ` (${windowCount})` : ""}
        </button>
      </div>
      <div aria-live="polite" className="min-h-0">
        {state.status === "saved" && (
          <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-xs font-medium text-brand">{savedMessage(state.report)}</p>
        )}
        {state.status === "error" && (
          <p role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            <span>Not saved: {state.message}</span>
            <button type="button" className="font-semibold underline" onClick={() => void save(state.scope)}>
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />;
}
