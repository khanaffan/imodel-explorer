import type { IModelConnection } from "@itwin/core-frontend";
import { create } from "zustand";
import { type CancelToken, DEFAULT_OPTIONS, GraphEngine, TraversalCancelled, type TraversalOptions } from "../engine/GraphEngine";
import { emptyGraph, type GraphData, type NodeKey, nodeKeyString, parseNodeKey } from "../engine/GraphModel";
import { createQueryPort, type QuerySource } from "../engine/IModelQueryPort";
import { RelationsTraversal, type StrategyName } from "../engine/TraversalStrategy";
import { type LayoutMode, reroot } from "../graph/layout";
import { type ColorTheme, loadTheme, saveTheme } from "./colorTheme";
import { NavigationHistory } from "./navigationHistory";
import type { SavedSession } from "../services/sessionStore";

export type Status =
  | { readonly kind: "idle"; readonly message?: string }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type Selection =
  | { readonly kind: "node"; readonly key: string }
  | { readonly kind: "edge"; readonly key: string }
  | undefined;

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly className: string;
}

export interface GraphState {
  readonly connection?: IModelConnection;
  readonly fileName?: string;
  readonly engine?: GraphEngine;
  readonly graph: GraphData;
  readonly options: TraversalOptions;
  readonly selection: Selection;
  readonly status: Status;
  readonly layoutMode: LayoutMode;
  readonly theme: ColorTheme;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** The centre before the latest recentre; lets the layout keep its orientation. */
  readonly previousCentre?: string;
  readonly models: readonly ModelInfo[];
  /** Bumped to ask the canvas to fit everything into view. */
  readonly fitRequest: number;
}

const OPTIONS_KEY = "instanceGraph.options";

function loadOptions(): TraversalOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    return { ...DEFAULT_OPTIONS, ...saved, expandedGroups: new Set() };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(o: TraversalOptions) {
  const { expandedGroups: _ignored, ...rest } = o;
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(rest));
}

export const useGraphStore = create<GraphState>(() => ({
  graph: emptyGraph(),
  options: typeof localStorage === "undefined" ? DEFAULT_OPTIONS : loadOptions(),
  selection: undefined,
  status: { kind: "idle" },
  layoutMode: "radial",
  theme: typeof localStorage === "undefined" ? loadTheme(undefined) : loadTheme(),
  canGoBack: false,
  canGoForward: false,
  models: [],
  fitRequest: 0,
}));

const history = new NavigationHistory();
let generation = 0;
let activeToken: { cancelled: boolean } | undefined;

const set = useGraphStore.setState;
const get = useGraphStore.getState;

function beginWork(message: string): CancelToken & { cancelled: boolean } {
  if (activeToken) activeToken.cancelled = true;
  generation++;
  activeToken = { cancelled: false };
  set({ status: { kind: "loading", message } });
  return activeToken;
}

function syncHistoryFlags() {
  set({ canGoBack: history.canGoBack, canGoForward: history.canGoForward });
}

function recordHistory(graph: GraphData, replace = false) {
  const centre = graph.nodes.get(graph.centreKey);
  const entry = { centreKey: graph.centreKey, label: centre?.label ?? graph.centreKey, graph, expandedGroups: new Set(get().options.expandedGroups) };
  if (replace) history.replaceCurrent(entry);
  else history.push(entry);
  syncHistoryFlags();
}

function fail(e: unknown) {
  if (e instanceof TraversalCancelled) return;
  set({ status: { kind: "error", message: e instanceof Error ? e.message : String(e) } });
}

function describe(graph: GraphData): string {
  const instances = [...graph.nodes.values()].filter((n) => !n.aggregate).length;
  const strategy = useGraphStore.getState().engine?.strategy;
  const degraded = strategy instanceof RelationsTraversal && strategy.degradedBatches > 0
    ? ` · Relations() failed on ${strategy.degradedBatches} batch(es) this session; metadata fallback answered them` : "";
  return `${instances} instances, ${graph.edges.size} relationships${graph.truncated ? " (node budget reached)" : ""}${degraded}`;
}

/** During a progressive load, keep showing the optimistic graph's outer rings until the fetch
 * reaches that depth, so nothing blinks out and back in. */
function mergeProgress(partial: GraphData, optimistic: GraphData | undefined): GraphData {
  if (!optimistic || optimistic.centreKey !== partial.centreKey) return partial;
  const reached = Math.max(0, ...[...partial.nodes.values()].map((n) => n.depth));
  const nodes = new Map(partial.nodes);
  for (const [k, n] of optimistic.nodes)
    if (!nodes.has(k) && n.depth > reached) nodes.set(k, n);
  const edges = new Map(partial.edges);
  for (const [k, e] of optimistic.edges)
    if (!edges.has(k) && nodes.has(e.source) && nodes.has(e.target)) edges.set(k, e);
  return { ...partial, nodes, edges };
}

async function loadModels(engine: GraphEngine): Promise<ModelInfo[]> {
  const rows = await engine.port.query(
    "SELECT m.ECInstanceId Id, m.ECClassId ClassId, p.CodeValue Code, p.UserLabel UserLabel FROM bis.Model m LEFT JOIN bis.Element p ON p.ECInstanceId = m.ModeledElement.Id");
  return rows
    .map((r) => ({ id: r.Id as string, name: (r.UserLabel ?? r.Code ?? r.Id) as string, className: engine.registry.nameOf(r.ClassId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const graphActions = {
  async attach(connection: IModelConnection, fileName: string, prefer?: StrategyName): Promise<void> {
    beginWork("Reading schemas…");
    history.clear();
    set({ connection, fileName, engine: undefined, graph: emptyGraph(), selection: undefined, models: [], options: { ...get().options, expandedGroups: new Set() } });
    syncHistoryFlags();
    try {
      const engine = await GraphEngine.create(createQueryPort(connection as unknown as QuerySource), prefer);
      const models = await loadModels(engine);
      set({ engine, models, status: { kind: "idle", message: `Traversal: ${engine.strategy.name === "relations" ? "ECVLib.Relations()" : "metadata fallback"}` } });
    } catch (e) {
      fail(e);
    }
  },

  detach(): void {
    if (activeToken) activeToken.cancelled = true;
    history.clear();
    set({ connection: undefined, fileName: undefined, engine: undefined, graph: emptyGraph(), selection: undefined, models: [], status: { kind: "idle" } });
    syncHistoryFlags();
  },

  async switchStrategy(name: StrategyName): Promise<void> {
    const { connection, fileName } = get();
    if (!connection || !fileName) return;
    const centre = get().graph.centreKey;
    await graphActions.attach(connection, fileName, name);
    if (centre) await graphActions.showInstance(parseNodeKey(centre));
  },

  /** Makes `key` the centre and loads its neighbourhood: degree 1 first, deeper rings streamed. */
  async showInstance(key: NodeKey, opts: { pushHistory?: boolean; fit?: boolean; expandedGroups?: ReadonlySet<string> } = {}): Promise<void> {
    const { engine, graph } = get();
    if (!engine) return;
    const centreKey = nodeKeyString(key);
    const token = beginWork("Loading relationships…");
    const myGeneration = generation;

    // Instant feedback: re-root what is already on screen.
    const optimistic = graph.nodes.has(centreKey) ? reroot(graph, centreKey) : undefined;
    set({
      previousCentre: graph.centreKey || undefined,
      selection: { kind: "node", key: centreKey },
      ...(optimistic ? { graph: optimistic } : {}),
    });
    const options = opts.pushHistory === false ? get().options : { ...get().options, expandedGroups: new Set<string>(opts.expandedGroups) };
    set({ options });

    try {
      const result = await engine.buildNeighbourhood(key, options, (partial) => {
        if (myGeneration === generation)
          set({ graph: mergeProgress(partial, optimistic) });
      }, token);
      if (myGeneration !== generation) return;
      set((s) => ({ graph: result, status: { kind: "idle", message: describe(result) }, fitRequest: opts.fit || !optimistic ? s.fitRequest + 1 : s.fitRequest }));
      recordHistory(result, opts.pushHistory === false);
    } catch (e) {
      if (myGeneration === generation) fail(e);
    }
  },

  async refresh(): Promise<void> {
    const centre = get().graph.centreKey;
    if (centre) await graphActions.showInstance(parseNodeKey(centre), { pushHistory: false, fit: true });
  },

  async expand(nodeKey: string): Promise<void> {
    const { engine, graph, options } = get();
    if (!engine) return;
    const token = beginWork("Expanding…");
    const myGeneration = generation;
    try {
      const result = await engine.expand(graph, nodeKey, options, token);
      if (myGeneration !== generation) return;
      set({ graph: result, status: { kind: "idle", message: describe(result) } });
      recordHistory(result, true);
    } catch (e) {
      if (myGeneration === generation) fail(e);
    }
  },

  collapse(nodeKey: string): void {
    const { engine, graph } = get();
    if (!engine) return;
    const result = engine.collapse(graph, nodeKey);
    set({ graph: result, status: { kind: "idle", message: describe(result) } });
    recordHistory(result, true);
  },

  async openAggregate(aggKey: string): Promise<void> {
    const { engine, graph, options } = get();
    if (!engine) return;
    const token = beginWork("Loading hidden relationships…");
    const myGeneration = generation;
    try {
      const { graph: result, expandedGroups } = await engine.openAggregate(graph, aggKey, options, token);
      if (myGeneration !== generation) return;
      set({ graph: result, options: { ...options, expandedGroups }, status: { kind: "idle", message: describe(result) } });
      recordHistory(result, true);
    } catch (e) {
      if (myGeneration === generation) fail(e);
    }
  },

  /** Primary click gesture: aggregates open, anything else becomes the centre. */
  async activate(nodeKey: string): Promise<void> {
    const node = get().graph.nodes.get(nodeKey);
    if (!node) return;
    if (node.aggregate) return graphActions.openAggregate(nodeKey);
    if (nodeKey === get().graph.centreKey) {
      set({ selection: { kind: "node", key: nodeKey } });
      return;
    }
    return graphActions.showInstance({ id: node.id, classId: node.classId });
  },

  back(): void { restore(history.back()); },
  forward(): void { restore(history.forward()); },

  select(selection: Selection): void { set({ selection }); },

  setOptions(patch: Partial<TraversalOptions>, reload = true): void {
    const options = { ...get().options, ...patch };
    set({ options });
    saveOptions(options);
    if (reload) void graphActions.refresh();
  },

  setLayoutMode(layoutMode: LayoutMode): void { set((s) => ({ layoutMode, fitRequest: s.fitRequest + 1 })); },

  setTheme(theme: ColorTheme): void {
    set({ theme });
    saveTheme(theme);
  },

  /** Re-applies a saved session to the open iModel: options, centre, then manual expansions. */
  async restoreSession(session: SavedSession): Promise<void> {
    const { expandedGroups: _g, ...current } = get().options;
    const options: TraversalOptions = {
      ...current, depth: session.depth, direction: session.direction, filters: session.filters,
      nodeBudget: session.nodeBudget, groupCap: session.groupCap, expandedGroups: new Set(session.expandedGroups),
    };
    set({ options, layoutMode: session.layoutMode });
    saveOptions(options);
    await graphActions.showInstance(session.centre, { fit: true, expandedGroups: options.expandedGroups });
    for (const k of session.expandedNodes) {
      const n = get().graph.nodes.get(k);
      if (n && !n.expanded) await graphActions.expand(k);
    }
  },

  requestFit(): void { set((s) => ({ fitRequest: s.fitRequest + 1 })); },
};

function restore(entry: ReturnType<NavigationHistory["back"]>) {
  if (!entry) return;
  if (activeToken) activeToken.cancelled = true;
  generation++;
  set((s) => ({
    previousCentre: s.graph.centreKey || undefined,
    graph: entry.graph,
    selection: { kind: "node", key: entry.centreKey },
    options: { ...s.options, expandedGroups: new Set(entry.expandedGroups) },
    status: { kind: "idle", message: describe(entry.graph) },
  }));
  syncHistoryFlags();
}

export const graphHistory = history;
