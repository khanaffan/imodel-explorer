import { type StatusBarItem, StatusBarItemUtilities, StatusBarSection, UiFramework } from "@itwin/appui-react";
import { useEffect, useState } from "react";
import { type AppMemory, formatBytes } from "../../common/appMemory";
import { filterCount } from "../engine/filters";
import { appHost } from "../host/AppHost";
import { useClassGraphStore } from "../state/classGraphStore";
import { useGraphStore } from "../state/graphStore";
import { FILTERS_WIDGET_ID } from "../widgets/FiltersWidget";

function IModelName() {
  const fileName = useGraphStore((s) => s.fileName);
  if (!fileName) return null;
  return <span className="ig-statusbar__item" title={fileName}>{fileName.split(/[\\/]/).pop()}</span>;
}

function GraphCounts() {
  const graph = useGraphStore((s) => s.graph);
  const classMode = useClassGraphStore((s) => s.mode === "classes");
  if (classMode || graph.nodes.size === 0) return null;
  const instances = [...graph.nodes.values()].filter((n) => !n.aggregate).length;
  return (
    <span className="ig-statusbar__item" data-testid="status-counts">
      {instances} instance{instances === 1 ? "" : "s"} · {graph.edges.size} relationship{graph.edges.size === 1 ? "" : "s"}
      {graph.truncated && <span className="ig-statusbar__warn" title="Traversal stopped at the node budget; raise it in Traversal & filters"> · budget reached</span>}
    </span>
  );
}

function FilterCount() {
  const filters = useGraphStore((s) => s.options.filters);
  const excluded = useGraphStore((s) => s.options.excludedInstances?.length ?? 0);
  const count = filterCount(filters) + excluded;
  return (
    <button type="button" className="ig-statusbar__item ig-statusbar__button" data-testid="status-filters"
      title="Open Traversal & filters"
      onClick={() => UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(FILTERS_WIDGET_ID)?.show()}>
      {count === 0 ? "No filters" : `${count} filter${count === 1 ? "" : "s"}`}
    </button>
  );
}

/** How long the last graph load took, measured from the store's loading → idle transition. */
function LastLoadTime() {
  const [ms, setMs] = useState<number>();
  useEffect(() => {
    let started: number | undefined = useGraphStore.getState().status.kind === "loading" ? performance.now() : undefined;
    return useGraphStore.subscribe((s, prev) => {
      if (s.status === prev.status) return;
      if (s.status.kind === "loading") {
        if (prev.status.kind !== "loading") started = performance.now();
      } else {
        if (s.status.kind === "idle" && started !== undefined) setMs(performance.now() - started);
        started = undefined;
      }
    });
  }, []);
  if (ms === undefined) return null;
  return <span className="ig-statusbar__item" title="Duration of the last graph load">Loaded in {ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}</span>;
}

const MEMORY_POLL_MS = 5000;

/** Memory used by all of the app's processes, refreshed while the window is visible. */
function MemoryUse() {
  const [memory, setMemory] = useState<AppMemory>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    const sample = () => {
      if (document.visibilityState !== "visible") return;
      appHost.appMemory().then(
        (m) => { if (live) { setMemory(m); setError(undefined); } },
        (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    };
    sample();
    const timer = setInterval(sample, MEMORY_POLL_MS);
    document.addEventListener("visibilitychange", sample);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", sample); };
  }, []);
  if (error) return <span className="ig-statusbar__item ig-statusbar__warn" title={error}>Memory unavailable</span>;
  if (!memory) return null;
  const detail = memory.groups.map((g) => `${g.label}: ${formatBytes(g.bytes)}`).join("\n");
  return (
    <span className="ig-statusbar__item" data-testid="status-memory" title={`Memory used by the app (all processes)\n${detail}`}>
      Memory {formatBytes(memory.totalBytes)}
    </span>
  );
}

export const STATUS_BAR_ITEMS: readonly StatusBarItem[] = [
  StatusBarItemUtilities.createCustomItem({ id: "ig-status-imodel", section: StatusBarSection.Left, itemPriority: 10, content: <IModelName /> }),
  StatusBarItemUtilities.createCustomItem({ id: "ig-status-counts", section: StatusBarSection.Center, itemPriority: 10, content: <GraphCounts /> }),
  StatusBarItemUtilities.createCustomItem({ id: "ig-status-filters", section: StatusBarSection.Center, itemPriority: 20, content: <FilterCount /> }),
  StatusBarItemUtilities.createCustomItem({ id: "ig-status-time", section: StatusBarSection.Right, itemPriority: 10, content: <LastLoadTime /> }),
  StatusBarItemUtilities.createCustomItem({ id: "ig-status-memory", section: StatusBarSection.Right, itemPriority: 20, content: <MemoryUse /> }),
];
