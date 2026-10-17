import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { plural } from "../../lib/format";
import { closeTabs, goToTab } from "../../lib/open-tab-actions";
import { duplicateTabIds, matchingOpenTabIds } from "../../lib/open-tabs";
import { CloseTabsControl } from "./close-tabs-control";
import { linkClass, SaveBar } from "./save-bar";
import { NoOpenTabs, OpenWindowsStatus } from "./save-panel";
import { TabPicker } from "./tab-picker";
import { useSavePicker } from "./use-save-picker";

/**
 * The manager's Open tabs view, like Session Buddy's "This Browser" (docs/UI_UX_DESIGN.md 18i, 18m):
 * every open window to search, go to, save from or close tabs in. >=1280px: the list | a panel
 * for the ticked tabs. Narrower: that panel sticks to the bottom of the page.
 */
export function OpenTabsView() {
  const picker = useSavePicker();
  const { open, windows, selection, setSelection } = picker;
  const [query, setQuery] = useState("");
  const duplicates = useMemo(() => duplicateTabIds(windows), [windows]);
  const matches = useMemo(() => matchingOpenTabIds(windows, query), [windows, query]);
  const tabCount = windows.reduce((sum, window) => sum + window.tabs.length, 0);
  // Every ticked tab, in list order, for the close confirmation's preview.
  const ticked = useMemo(() => windows.flatMap((window) => window.tabs.filter((tab) => selection.has(tab.id))), [windows, selection]);

  const saveAndClose = async () => {
    const ids = [...selection];
    return (await picker.save()) ? closeTabs(ids) : null;
  };

  let list;
  if (open.status !== "ready") list = <OpenWindowsStatus open={open} />;
  else if (windows.length === 0) list = <NoOpenTabs />;
  else if (matches?.size === 0) list = <NoOpenTabs>{`No open tabs match "${query.trim()}".`}</NoOpenTabs>;
  else
    list = (
      <TabPicker
        windows={windows}
        currentWindowId={open.currentWindowId}
        selection={selection}
        onChange={setSelection}
        expandAll
        visible={matches}
        duplicates={duplicates}
        onGoTo={(tab, windowId) => void goToTab(tab.id, windowId)}
        onClose={(tab) => void closeTabs([tab.id])}
      />
    );

  return (
    <main aria-label="Open tabs" className="min-w-0 xl:grid xl:h-screen xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 xl:overflow-y-auto">
        <header className="space-y-3 border-b border-line bg-surface px-4 py-5 lg:px-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Open tabs</h1>
            {open.status === "ready" && (
              <p className="text-xs tabular-nums text-fg-muted">
                {plural(windows.length, "window")} · {plural(tabCount, "tab")}
                {duplicates.size > 0 && ` · ${plural(duplicates.size, "duplicate")}`}
              </p>
            )}
          </div>
          <p className="max-w-2xl text-[13px] text-fg-muted">
            Tick tabs to save them as a session or to close them. Click a title to go to that tab.
          </p>
          <label className="flex max-w-xl items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:outline-2 focus-within:outline-focus">
            <Search aria-hidden="true" className="size-4 text-fg-muted" />
            <span className="sr-only">Search open tabs</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search open tabs by title or address"
              className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-fg-muted"
            />
          </label>
        </header>
        <div className="p-4 lg:p-6">{list}</div>
      </div>

      <aside
        aria-label="Selected tabs"
        className="sticky bottom-0 z-10 space-y-3 border-t border-line bg-surface px-4 py-3 lg:px-6 xl:static xl:overflow-y-auto xl:border-t-0 xl:border-l xl:p-5"
      >
        <SaveBar
          summary={picker.summary}
          name={picker.name}
          onName={picker.setName}
          destination={picker.destination}
          result={picker.result}
          onSave={() => void picker.save()}
          onSelectAll={picker.selectAll}
          onSelectNone={picker.selectNone}
          selectExtras={
            <>
              {matches !== null && matches.size > 0 && (
                <button type="button" className={linkClass} onClick={() => setSelection(matches)}>
                  Select matches ({matches.size})
                </button>
              )}
              {duplicates.size > 0 && (
                <button type="button" className={linkClass} onClick={() => setSelection(duplicates)}>
                  Select duplicates ({duplicates.size})
                </button>
              )}
            </>
          }
        />
        <div className="border-t border-line pt-2">
          <CloseTabsControl
            tabs={ticked}
            canSave={picker.destination !== null && picker.name.trim().length > 0 && picker.result.status !== "saving"}
            onClose={() => closeTabs([...selection])}
            onSaveAndClose={saveAndClose}
          />
        </div>
      </aside>
    </main>
  );
}
