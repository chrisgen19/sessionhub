import { ExternalLink } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { browser } from "wxt/browser";
import { BrandMark } from "../../components/brand";
import { SyncStatusChip } from "../../components/sync-status-chip";
import { ThemeToggle } from "../../components/theme-toggle";
import { useSessions } from "../../hooks/use-sessions";
import { readPopupTab, savePopupTab, type PopupTab } from "../../lib/open-preferences";
import { SavePanel } from "../save/save-panel";
import { OpenTab } from "./open-tab";

const TABS: { id: PopupTab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "save", label: "Save" },
];

/** Opens the manager in a tab: on a session, on a view (`#view=open-tabs`), or its start page. */
const openManager = async (hash = "") => {
  await browser.tabs.create({ url: `${browser.runtime.getURL("/manager.html")}${hash}` });
  window.close();
};

/**
 * The toolbar popup (docs/UI_UX_DESIGN.md 18k): Open and Save tabs under a fixed header, a fixed
 * footer, and one scrolling area between them, so it stays inside Chrome's 600 px popup limit. The
 * Save tab stays mounted while hidden, so its ticks and name survive switching tabs.
 */
export function PopupApp() {
  const { state, retry } = useSessions();
  const [tab, setTab] = useState<PopupTab>(readPopupTab);
  const tabButtons = useRef<Partial<Record<PopupTab, HTMLButtonElement | null>>>({});

  const choose = (next: PopupTab) => {
    setTab(next);
    savePopupTab(next);
  };
  // Left and right arrows move between the two tabs (WAI-ARIA tabs pattern).
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "open" ? "save" : "open";
    choose(next);
    tabButtons.current[next]?.focus();
  };

  return (
    <div className="flex max-h-[600px] w-[380px] flex-col bg-surface text-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <BrandMark size="sm" />
          <h1 className="text-[15px] font-bold tracking-tight">SessionHub</h1>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatusChip />
          <ThemeToggle />
        </div>
      </header>

      <div role="tablist" aria-label="Popup sections" onKeyDown={onTabKey} className="flex shrink-0 gap-1 border-b border-line px-3">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            ref={(element) => {
              tabButtons.current[id] = element;
            }}
            type="button"
            role="tab"
            id={`popup-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`popup-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => choose(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === id ? "border-brand text-brand" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The only scroll area. `relative` keeps absolutely positioned sr-only text inside it. */}
      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div role="tabpanel" id="popup-panel-open" aria-labelledby="popup-tab-open" hidden={tab !== "open"} className="px-4 pt-3 pb-4">
          <OpenTab state={state} onRetry={retry} onOpenManager={(hash) => void openManager(hash)} />
        </div>
        <div role="tabpanel" id="popup-panel-save" aria-labelledby="popup-tab-save" hidden={tab !== "save"} className="px-4 pt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Save tabs</h2>
            <button type="button" onClick={() => void openManager("#view=open-tabs")} className="text-xs font-semibold text-brand hover:underline">
              Open full view
            </button>
          </div>
          <SavePanel />
        </div>
      </main>

      <footer className="shrink-0 border-t border-line bg-canvas px-4 py-3">
        <button
          type="button"
          onClick={() => void openManager()}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface text-[13px] font-semibold hover:bg-surface-muted"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Open manager
        </button>
      </footer>
    </div>
  );
}
