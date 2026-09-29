import type { TraversalOptions } from "../engine/GraphEngine";
import { type GraphData, type NodeKey, parseNodeKey } from "../engine/GraphModel";
import { EMPTY_FILTERS, type FilterSpec } from "../engine/filters";
import type { LayoutMode } from "../graph/layout";

export interface SavedSession {
  readonly format: "instance-graph-session";
  readonly version: 1;
  readonly name: string;
  readonly savedAt: string;
  /** Path of the iModel the session was captured on. */
  readonly fileName: string;
  readonly centre: NodeKey;
  readonly depth: number;
  readonly direction: TraversalOptions["direction"];
  readonly filters: FilterSpec;
  readonly nodeBudget: number;
  readonly groupCap: number;
  readonly expandedGroups: string[];
  /** Nodes the user expanded by hand, in hop order, so they can be replayed. */
  readonly expandedNodes: string[];
  readonly layoutMode: LayoutMode;
}

const STORAGE_KEY = "instanceGraph.sessions";

export function captureSession(name: string, fileName: string, graph: GraphData, options: TraversalOptions, layoutMode: LayoutMode): SavedSession | undefined {
  if (!graph.centreKey) return undefined;
  const expandedNodes = [...graph.nodes.values()]
    .filter((n) => n.expanded && !n.aggregate && n.key !== graph.centreKey && n.depth >= options.depth)
    .sort((a, b) => a.depth - b.depth)
    .map((n) => n.key);
  return {
    format: "instance-graph-session", version: 1, name, savedAt: new Date().toISOString(), fileName,
    centre: parseNodeKey(graph.centreKey), depth: options.depth, direction: options.direction, filters: options.filters,
    nodeBudget: options.nodeBudget, groupCap: options.groupCap, expandedGroups: [...options.expandedGroups], expandedNodes, layoutMode,
  };
}

/** Validates untrusted JSON (an imported file or old storage) into a session. */
export function parseSession(value: unknown): SavedSession {
  const v = value as Partial<SavedSession> | null;
  if (!v || v.format !== "instance-graph-session" || v.version !== 1)
    throw new Error("Not an InstanceGraph session file");
  if (!v.centre || typeof v.centre.id !== "string" || typeof v.centre.classId !== "string")
    throw new Error("Session has no centre instance");
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : d);
  const f = v.filters ?? EMPTY_FILTERS;
  return {
    format: "instance-graph-session", version: 1,
    name: typeof v.name === "string" ? v.name : "Imported session",
    savedAt: typeof v.savedAt === "string" ? v.savedAt : new Date().toISOString(),
    fileName: typeof v.fileName === "string" ? v.fileName : "",
    centre: { id: v.centre.id, classId: v.centre.classId },
    depth: Math.min(6, num(v.depth, 1)),
    direction: v.direction === "forward" || v.direction === "backward" ? v.direction : "both",
    filters: { models: f.models ?? {}, schemas: f.schemas ?? {}, classes: f.classes ?? {}, relationships: f.relationships ?? {} },
    nodeBudget: num(v.nodeBudget, 750),
    groupCap: num(v.groupCap, 25),
    expandedGroups: Array.isArray(v.expandedGroups) ? v.expandedGroups.filter((s) => typeof s === "string") : [],
    expandedNodes: Array.isArray(v.expandedNodes) ? v.expandedNodes.filter((s) => typeof s === "string") : [],
    layoutMode: v.layoutMode === "layered" ? "layered" : "radial",
  };
}

export function listSessions(storage: Pick<Storage, "getItem"> = localStorage): SavedSession[] {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: SavedSession[] = [];
    for (const r of raw) {
      try { out.push(parseSession(r)); } catch { /* skip corrupt entries */ }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function storeSession(session: SavedSession, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const others = listSessions(storage).filter((s) => !(s.name === session.name && s.fileName === session.fileName));
  storage.setItem(STORAGE_KEY, JSON.stringify([session, ...others]));
}

export function deleteSession(session: SavedSession, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(listSessions(storage).filter((s) => !(s.name === session.name && s.fileName === session.fileName))));
}
