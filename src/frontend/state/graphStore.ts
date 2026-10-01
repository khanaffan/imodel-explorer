import type { IModelConnection } from "@itwin/core-frontend";
import { create } from "zustand";
import { type CancelToken, DEFAULT_OPTIONS, DEFAULT_PATH_LIMITS, GraphEngine, type PathResult, TraversalCancelled, type TraversalOptions } from "../engine/GraphEngine";
import { emptyGraph, type GraphData, type GraphEdge, type NodeKey, nodeKeyString, normalizeExcludedInstances, parseNodeKey } from "../engine/GraphModel";
import { EMPTY_FILTERS, type FilterSpec, type FilterState } from "../engine/filters";
import { composeDisplay, type Pin, type PinOffset, type Pins, prunePinEdges, retainPins } from "../engine/pins";
import { createQueryPort, type QuerySource } from "../engine/IModelQueryPort";
import { RelationsTraversal, type StrategyName } from "../engine/TraversalStrategy";
import { type LayoutMode, reroot } from "../graph/layout";
import { type ColorTheme, loadTheme, saveTheme } from "./colorTheme";
import { NavigationHistory } from "./navigationHistory";
import type { SavedSession } from "../services/sessionStore";
import { type InstanceReference, resolveInstanceReferenceClassId } from "../engine/instanceProperties";
import { notify } from "../commands/notify";

export type Status =
  | { readonly kind: "idle"; readonly message?: string }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type Selection =
  | { readonly kind: "node"; readonly key: string }
  | { readonly kind: "edge"; readonly key: string }
  | undefined;

/** Selections are compared by value: reloads and re-clicks create new objects for the same thing. */
export function sameSelection(a: Selection, b: Selection): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.key === b.key);
}

import type { ModelInfo } from "../engine/models";
export type { ModelInfo };

export interface GraphState {
  readonly connection?: IModelConnection;
  readonly fileName?: string;
  readonly engine?: GraphEngine;
  /** What is displayed: {@link baseGraph} plus pinned nodes and their edges. */
  readonly graph: GraphData;
  /** The traversal result around the centre; what expand/collapse/budget operate on. */
  readonly baseGraph: GraphData;
  readonly pins: Pins;
  /** Edges linking pins to displayed nodes that the traversal did not produce. */
  readonly pinEdges: ReadonlyMap<string, GraphEdge>;
  readonly options: TraversalOptions;
  readonly selection: Selection;
  /** Class the Schema widget was navigated to. Only applies while {@link selection} still refers to
   * the same node or edge (see {@link sameSelection}); selecting something else makes the widget
   * follow the selection again. */
  readonly schemaFocus?: { readonly className: string; readonly forSelection: Selection };
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
  /** Back/Forward history as breadcrumbs; `crumbIndex` is the entry shown. */
  readonly crumbs: ReadonlyArray<{ readonly label: string; readonly isPath: boolean }>;
  readonly crumbIndex: number;
  readonly canUndoFilters: boolean;
  readonly canRedoFilters: boolean;
  /** Set while the graph shows a path search result rather than a neighbourhood. */
  readonly pathView?: { readonly from: string; readonly to: string; readonly label: string };
  readonly pathSearching: boolean;
}

const OPTIONS_KEY = "instanceGraph.options";

function loadOptions(): TraversalOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    return { ...DEFAULT_OPTIONS, ...saved, excludedInstances: [], expandedGroups: new Set() };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(o: TraversalOptions) {
  const { expandedGroups: _ignored, excludedInstances: _instances, ...rest } = o;
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(rest));
}

const NO_PINS: Pins = new Map();
const NO_EDGES: ReadonlyMap<string, GraphEdge> = new Map();

export const useGraphStore = create<GraphState>(() => ({
  graph: emptyGraph(),
  baseGraph: emptyGraph(),
  pins: NO_PINS,
  pinEdges: NO_EDGES,
  options: typeof localStorage === "undefined" ? DEFAULT_OPTIONS : loadOptions(),
  selection: undefined,
  status: { kind: "idle" },
  layoutMode: "radial",
  theme: typeof localStorage === "undefined" ? loadTheme(undefined) : loadTheme(),
  canGoBack: false,
  canGoForward: false,
  models: [],
  fitRequest: 0,
  crumbs: [],
  crumbIndex: -1,
  canUndoFilters: false,
  canRedoFilters: false,
  pathSearching: false,
}));

const history = new NavigationHistory();
let generation = 0;
let activeToken: { cancelled: boolean } | undefined;
let pathToken: { cancelled: boolean } | undefined;

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
  set({
    canGoBack: history.canGoBack, canGoForward: history.canGoForward,
    crumbs: history.entries.map((e) => ({ label: e.label, isPath: !!e.path })), crumbIndex: history.index,
  });
}

/** Undo/redo over filter and instance-exclusion edits (not depth, budgets or navigation). */
interface FilterSnapshot {
  readonly filters: FilterSpec;
  readonly excludedInstances: readonly string[];
}
const FILTER_UNDO_LIMIT = 50;
const filterUndo: FilterSnapshot[] = [];
const filterRedo: FilterSnapshot[] = [];
let replayingFilters = false;

function filterSnapshot(o: TraversalOptions): FilterSnapshot {
  return { filters: o.filters, excludedInstances: o.excludedInstances ?? [] };
}

function sameFilters(a: FilterSnapshot, b: FilterSnapshot): boolean {
  return JSON.stringify(a.filters) === JSON.stringify(b.filters) && sameExclusions(a.excludedInstances, b.excludedInstances);
}

function syncFilterUndo() {
  set({ canUndoFilters: filterUndo.length > 0, canRedoFilters: filterRedo.length > 0 });
}

function clearFilterUndo() {
  filterUndo.length = 0;
  filterRedo.length = 0;
  syncFilterUndo();
}

function stepFilters(from: FilterSnapshot[], to: FilterSnapshot[]) {
  const target = from[from.length - 1];
  if (!target) return;
  const current = filterSnapshot(get().options);
  replayingFilters = true;
  try {
    // Throws (leaving both stacks as they were) if the target would exclude the current centre.
    graphActions.setOptions({ filters: target.filters, excludedInstances: target.excludedInstances });
  } finally {
    replayingFilters = false;
  }
  from.pop();
  to.push(current);
  syncFilterUndo();
}

function centreOnly(graph: GraphData, key = graph.centreKey): GraphData {
  const centre = graph.nodes.get(key);
  return { ...emptyGraph(key), nodes: centre ? new Map([[key, { ...centre, expanded: false }]]) : new Map() };
}

/** Sets the traversal result and pins together, deriving the displayed graph. */
function setBase(baseGraph: GraphData, pins: Pins = get().pins, pinEdges: ReadonlyMap<string, GraphEdge> = get().pinEdges, extra: Partial<GraphState> = {}, showPinOverlay = true) {
  const excluded = new Set((extra.options ?? get().options).excludedInstances);
  const eligible = new Map([...pins].filter(([key]) => !excluded.has(key)));
  const edges = prunePinEdges(baseGraph, eligible, pinEdges);
  set({ ...extra, baseGraph, pins: eligible, pinEdges: edges, graph: showPinOverlay ? composeDisplay(baseGraph, eligible, edges) : baseGraph });
}

/** Re-links pins to a new traversal result and drops the ones no longer connected. */
async function settlePins(base: GraphData, token: CancelToken, pins: Pins = get().pins, extraEdges: Iterable<GraphEdge> = []): Promise<{ pins: Pins; pinEdges: Map<string, GraphEdge> }> {
  const excluded = new Set(get().options.excludedInstances);
  pins = new Map([...pins].filter(([key]) => !excluded.has(key)));
  const candidates = new Map<string, GraphEdge>();
  for (const e of extraEdges) candidates.set(e.key, e);
  if (pins.size === 0) return { pins, pinEdges: new Map() };
  const engine = get().engine;
  try {
    if (engine) for (const [k, e] of await engine.connectPinned(base, pins, get().options, token)) candidates.set(k, e);
  } catch (e) {
    if (e instanceof TraversalCancelled || excluded.size > 0) throw e;
    for (const [k, edge] of get().pinEdges) candidates.set(k, edge); // best effort: keep what we knew
  }
  const kept = retainPins(base, pins, candidates);
  return { pins: kept, pinEdges: prunePinEdges(base, kept, candidates) };
}

/** Base edges touching a pin: after a collapse they can be all that still links a pin. */
function pinTouchingEdges(base: GraphData, pins: Pins): GraphEdge[] {
  return [...base.edges.values()].filter((e) => pins.has(e.source) || pins.has(e.target));
}

function recordHistory(graph: GraphData, replace = false) {
  const centre = graph.nodes.get(graph.centreKey);
  const { pins, pinEdges, pathView } = get();
  const entry = {
    centreKey: graph.centreKey, label: pathView?.label ?? centre?.label ?? graph.centreKey, graph, expandedGroups: new Set(get().options.expandedGroups), pins, pinEdges,
    ...(pathView ? { path: { from: pathView.from, to: pathView.to } } : {}),
  };
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

export const graphActions = {
  async attach(connection: IModelConnection, fileName: string, prefer?: StrategyName): Promise<void> {
    const sameConnection = get().connection === connection;
    const excludedInstances = sameConnection ? get().options.excludedInstances : [];
    beginWork("Reading schemas…");
    history.clear();
    if (!sameConnection) clearFilterUndo();
    set({ connection, fileName, engine: undefined, graph: emptyGraph(), baseGraph: emptyGraph(), pins: NO_PINS, pinEdges: NO_EDGES, selection: undefined, schemaFocus: undefined, pathView: undefined, models: [], options: { ...get().options, excludedInstances, expandedGroups: new Set() } });
    syncHistoryFlags();
    try {
      const engine = await GraphEngine.create(createQueryPort(connection as unknown as QuerySource), prefer);
      set({ engine, models: engine.models, status: { kind: "idle", message: `Traversal: ${engine.strategy.name === "relations" ? "ECVLib.Relations()" : "metadata fallback"}` } });
    } catch (e) {
      fail(e);
    }
  },

  detach(): void {
    if (activeToken) activeToken.cancelled = true;
    history.clear();
    clearFilterUndo();
    set({ connection: undefined, fileName: undefined, engine: undefined, graph: emptyGraph(), baseGraph: emptyGraph(), pins: NO_PINS, pinEdges: NO_EDGES, selection: undefined, schemaFocus: undefined, pathView: undefined, models: [], options: { ...get().options, excludedInstances: [] }, status: { kind: "idle" } });
    syncHistoryFlags();
  },

  async switchStrategy(name: StrategyName): Promise<void> {
    const { connection, fileName } = get();
    if (!connection || !fileName) return;
    const centre = get().graph.centreKey;
    await graphActions.attach(connection, fileName, name);
    if (centre) await show(parseNodeKey(centre), { keepPins: false });
  },

  /** Recentres from inside the graph (a node, a navigation link, "Centre here"): pins are kept. */
  async centreOn(key: NodeKey): Promise<void> {
    await show(key, { keepPins: true });
  },

  async centreOnReference(target: InstanceReference): Promise<void> {
    const engine = get().engine;
    if (!engine) { fail(new Error("Open an iModel before following an instance link.")); return; }
    beginWork(`Resolving ${target.id}…`);
    const myGeneration = generation;
    try {
      const classId = await resolveInstanceReferenceClassId(engine.port, target);
      if (myGeneration !== generation || get().engine !== engine) return;
      if (!classId) throw new Error(`Instance ${target.id} was not found${target.targetBaseClass ? ` in ${target.targetBaseClass}` : ""}.`);
      await graphActions.centreOn({ id: target.id, classId });
    } catch (e) {
      if (myGeneration === generation && get().engine === engine) fail(e);
    }
  },

  /** Recentres from outside the graph (seed query, 3D view, trees): starts over, clearing pins. */
  async seedExternal(key: NodeKey, opts: { fit?: boolean } = {}): Promise<void> {
    await show(key, { keepPins: false, fit: opts.fit });
  },

  async refresh(discardOptimistic = false): Promise<void> {
    const centre = get().graph.centreKey;
    if (centre) await show(parseNodeKey(centre), { pushHistory: false, fit: true, keepPins: true, discardOptimistic, preserveSelection: true });
  },

  async expand(nodeKey: string): Promise<void> {
    const { engine, options } = get();
    if (!engine) return;
    const token = beginWork("Expanding…");
    const myGeneration = generation;
    try {
      const base = absorbPin(get().baseGraph, nodeKey);
      const result = await engine.expand(base, nodeKey, options, token);
      const settled = await settlePins(result, token);
      if (myGeneration !== generation) return;
      setBase(result, settled.pins, settled.pinEdges, { status: { kind: "idle", message: describe(result) } });
      recordHistory(result, true);
    } catch (e) {
      if (myGeneration === generation) fail(e);
    }
  },

  collapse(nodeKey: string): void {
    const { engine, baseGraph, pins, pinEdges } = get();
    if (!engine || !baseGraph.nodes.has(nodeKey)) return;
    const result = engine.collapse(baseGraph, nodeKey);
    const candidates = new Map(pinEdges);
    for (const e of pinTouchingEdges(baseGraph, pins)) candidates.set(e.key, e);
    const kept = retainPins(result, pins, candidates);
    setBase(result, kept, prunePinEdges(result, kept, candidates), { status: { kind: "idle", message: describe(result) } });
    recordHistory(result, true);
  },

  async openAggregate(aggKey: string): Promise<void> {
    const { engine, baseGraph, options } = get();
    if (!engine) return;
    const token = beginWork("Loading hidden relationships…");
    const myGeneration = generation;
    try {
      const { graph: result, expandedGroups } = await engine.openAggregate(baseGraph, aggKey, options, token);
      const settled = await settlePins(result, token);
      if (myGeneration !== generation) return;
      setBase(result, settled.pins, settled.pinEdges, { options: { ...options, expandedGroups }, status: { kind: "idle", message: describe(result) } });
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
    return show({ id: node.id, classId: node.classId }, { keepPins: true });
  },

  /** Pins or unpins a displayed instance. */
  togglePin(nodeKey: string): void {
    const { graph, baseGraph, pins, pinEdges } = get();
    const node = graph.nodes.get(nodeKey);
    if (!node || node.aggregate || get().options.excludedInstances?.includes(nodeKey)) return;
    const next = new Map(pins);
    if (next.has(nodeKey)) next.delete(nodeKey);
    else next.set(nodeKey, { node });
    setBase(baseGraph, next, prunePinEdges(baseGraph, next, pinEdges));
    recordPinChange();
  },

  unpinAll(): void {
    if (get().pins.size === 0) return;
    setBase(get().baseGraph, NO_PINS, NO_EDGES);
    recordPinChange();
  },

  /** Where a pin sits relative to the centre; set by the canvas. Does not change the graph. */
  setPinOffset(nodeKey: string, offset: PinOffset | undefined): void {
    const pin = get().pins.get(nodeKey);
    if (!pin || (pin.offset?.x === offset?.x && pin.offset?.y === offset?.y)) return;
    const pins = new Map(get().pins);
    pins.set(nodeKey, { ...pin, offset });
    set({ pins });
    recordPinChange();
  },

  back(): void { restore(history.back()); },
  forward(): void { restore(history.forward()); },
  goToHistory(index: number): void { restore(history.goTo(index)); },

  undoFilters(): void { stepFilters(filterUndo, filterRedo); },
  redoFilters(): void { stepFilters(filterRedo, filterUndo); },

  /** Replaces the graph with the shortest path from the centre to `target` that traversal could
   * take with the current filters. Says why when there is none. */
  async findPath(target: NodeKey): Promise<PathResult | undefined> {
    const { engine, graph } = get();
    if (!engine) throw new Error("Open an iModel first.");
    const from = graph.centreKey;
    if (!from) throw new Error("Centre the graph on an instance first.");
    const to = nodeKeyString(target);
    if (to === from) throw new Error("Pick an instance other than the centre.");
    const token = beginWork("Finding path…");
    const myGeneration = generation;
    pathToken = token;
    set({ pathSearching: true });
    try {
      const result = await engine.findPath(parseNodeKey(from), target, get().options, DEFAULT_PATH_LIMITS, token, (visited) => {
        if (myGeneration === generation) set({ status: { kind: "loading", message: `Finding path… ${visited} instances searched` } });
      });
      if (myGeneration !== generation) return undefined;
      if (result.kind === "none") {
        const why = result.reason === "hops" ? `within ${DEFAULT_PATH_LIMITS.maxHops} relationships`
          : result.reason === "visited" ? `after searching ${result.visited} instances` : "with the current filters, exclusions and direction";
        const message = `No path ${why}.${result.capped ? " Large fans were sampled, so one may pass through a hub." : ""}`;
        set({ status: { kind: "idle", message } });
        notify.warning(message);
        return result;
      }
      const settled = await settlePins(result.graph, token);
      if (myGeneration !== generation) return undefined;
      const label = `Path: ${result.graph.nodes.get(from)?.label ?? from} → ${result.graph.nodes.get(to)?.label ?? to}`;
      setBase(result.graph, settled.pins, settled.pinEdges, {
        pathView: { from, to, label }, previousCentre: from, selection: { kind: "node", key: to },
        status: { kind: "idle", message: `${label} · ${result.hops} relationship${result.hops === 1 ? "" : "s"} · ${result.visited} instances searched` },
      });
      set((s) => ({ fitRequest: s.fitRequest + 1 }));
      recordHistory(result.graph);
      return result;
    } catch (e) {
      if (e instanceof TraversalCancelled) return undefined;
      if (myGeneration === generation) fail(e);
      throw e;
    } finally {
      if (pathToken === token) {
        pathToken = undefined;
        set({ pathSearching: false });
      }
    }
  },

  /** Stops a running path search; false when none is running. */
  cancelPathSearch(): boolean {
    if (!pathToken || pathToken !== activeToken) return false;
    pathToken.cancelled = true;
    pathToken = undefined;
    set({ pathSearching: false, status: { kind: "idle", message: "Path search cancelled." } });
    return true;
  },

  select(selection: Selection): void { set({ selection }); },

  /** Point the Schema widget at a class; `undefined` returns it to following the selection. */
  exploreSchema(className: string | undefined): void {
    set({ schemaFocus: className ? { className, forSelection: get().selection } : undefined });
  },

  setOptions(patch: Partial<TraversalOptions>, reload = true): void {
    const options = { ...get().options, ...patch };
    if (patch.excludedInstances !== undefined) {
      options.excludedInstances = normalizeExcludedInstances(patch.excludedInstances);
      if (options.excludedInstances.includes(get().graph.centreKey))
        throw new Error("The centre cannot be excluded. Centre on another instance first.");
    }
    const changedInstances = !sameExclusions(options.excludedInstances, get().options.excludedInstances);
    const before = filterSnapshot(get().options);
    if (!replayingFilters && !sameFilters(before, filterSnapshot(options))) {
      filterUndo.push(before);
      if (filterUndo.length > FILTER_UNDO_LIMIT) filterUndo.shift();
      filterRedo.length = 0;
      syncFilterUndo();
    }
    if (changedInstances) {
      history.clear();
      syncHistoryFlags();
    }
    if (changedInstances) {
      const { baseGraph, pins } = get();
      setBase(centreOnly(baseGraph), pins, NO_EDGES, {
        options,
        ...(get().engine && baseGraph.centreKey ? { status: { kind: "loading", message: "Applying instance exclusions..." } as const } : {}),
      }, false);
    } else set({ options });
    saveOptions(options);
    if (reload || changedInstances) void graphActions.refresh(changedInstances);
  },

  setFilter(dimension: "classes" | "relationships" | "models", name: string, state: FilterState): boolean {
    const filters = get().options.filters;
    const current = filters[dimension][name];
    if (dimension === "models" ? current === state : typeof current === "object" && current.state === state && !current.polymorphic)
      return false;
    const value = dimension === "models" ? state : { state, polymorphic: false };
    const next: FilterSpec = dimension === "models"
      ? { ...filters, models: { ...filters.models, [name]: state } }
      : { ...filters, [dimension]: { ...filters[dimension], [name]: value } };
    graphActions.setOptions({ filters: next });
    return true;
  },

  excludeInstance(key: string): boolean {
    const normalized = normalizeExcludedInstances([key])[0];
    const excluded = get().options.excludedInstances ?? [];
    if (excluded.includes(normalized)) return false;
    graphActions.setOptions({ excludedInstances: [...excluded, normalized] });
    return true;
  },

  removeInstanceExclusion(key: string): void {
    graphActions.setOptions({ excludedInstances: (get().options.excludedInstances ?? []).filter((k) => k !== key) });
  },

  clearFilters(): void {
    graphActions.setOptions({ filters: EMPTY_FILTERS, excludedInstances: [] });
  },

  setLayoutMode(layoutMode: LayoutMode): void { set((s) => ({ layoutMode, fitRequest: s.fitRequest + 1 })); },

  setTheme(theme: ColorTheme): void {
    set({ theme });
    saveTheme(theme);
  },

  /** Re-applies a saved session to the open iModel: options, centre, then manual expansions. */
  async restoreSession(session: SavedSession): Promise<void> {
    if (!get().engine) throw new Error("Open an iModel before restoring a session");
    const excludedInstances = normalizeExcludedInstances(session.excludedInstances);
    if (excludedInstances.includes(nodeKeyString(session.centre)))
      throw new Error("Session excludes its own centre instance");
    history.clear();
    syncHistoryFlags();
    clearFilterUndo();
    const { expandedGroups: _g, ...current } = get().options;
    const options: TraversalOptions = {
      ...current, depth: session.depth, direction: session.direction, filters: session.filters, excludedInstances,
      nodeBudget: session.nodeBudget, groupCap: session.groupCap, expandedGroups: new Set(session.expandedGroups),
    };
    setBase(centreOnly(get().baseGraph, nodeKeyString(session.centre)), NO_PINS, NO_EDGES,
      { options, layoutMode: session.layoutMode, status: { kind: "loading", message: "Restoring session..." } });
    saveOptions(options);
    const loading = show(session.centre, { fit: true, expandedGroups: options.expandedGroups, keepPins: false, discardOptimistic: true });
    const restoringGeneration = generation;
    await loading;
    if (generation !== restoringGeneration) return;
    const status = get().status;
    if (status.kind === "error") throw new Error(status.message);
    const engine = get().engine;
    if (engine && session.pinned && session.pinned.length > 0 && get().graph.centreKey === nodeKeyString(session.centre)) {
      const token = beginWork("Restoring pins…");
      const myGeneration = generation;
      try {
        const keys = session.pinned.filter((p) => !excludedInstances.includes(p.key)).map((p) => parseNodeKey(p.key));
        const existing = await engine.existingKeys(keys);
        const resolved = await engine.resolver.resolve(keys.filter((k) => existing.has(nodeKeyString(k))));
        const pins = new Map<string, Pin>();
        for (const p of session.pinned) {
          const n = resolved.get(p.key);
          if (n) pins.set(p.key, { node: { ...n, depth: 0, expanded: false }, offset: p.offset });
        }
        const base = get().baseGraph;
        const settled = await settlePins(base, token, pins);
        if (myGeneration !== generation) return;
        setBase(base, settled.pins, settled.pinEdges, { status: { kind: "idle", message: describe(base) } });
      } catch (e) {
        if (myGeneration === generation) fail(e);
      }
    }
    for (const k of session.expandedNodes) {
      const n = get().graph.nodes.get(k);
      if (n && !n.expanded) await graphActions.expand(k);
    }
    recordHistory(get().baseGraph, true);
  },

  requestFit(): void { set((s) => ({ fitRequest: s.fitRequest + 1 })); },
};

function restore(entry: ReturnType<NavigationHistory["back"]>) {
  if (!entry) return;
  if (activeToken) activeToken.cancelled = true;
  generation++;
  const s = get();
  setBase(entry.graph, entry.pins, entry.pinEdges, {
    pathView: entry.path ? { ...entry.path, label: entry.label } : undefined,
    previousCentre: s.graph.centreKey || undefined,
    selection: { kind: "node", key: entry.centreKey },
    options: { ...s.options, expandedGroups: new Set(entry.expandedGroups) },
    status: { kind: "idle", message: describe(entry.graph) },
  });
  syncHistoryFlags();
}

/** Pin changes update the current history entry, unless a load is in flight (its own record
 * will pick the pins up). */
function recordPinChange() {
  if (get().status.kind !== "loading" && get().baseGraph.centreKey) recordHistory(get().baseGraph, true);
}

/** Expanding a pin that is outside the traversal result first brings it (and its links) into it. */
function absorbPin(base: GraphData, nodeKey: string): GraphData {
  const { pins, pinEdges } = get();
  if (base.nodes.has(nodeKey) || !pins.has(nodeKey)) return base;
  const display = composeDisplay(base, pins, pinEdges);
  const nodes = new Map(base.nodes);
  nodes.set(nodeKey, display.nodes.get(nodeKey)!);
  const edges = new Map(base.edges);
  for (const [k, e] of pinEdges)
    if ((e.source === nodeKey && nodes.has(e.target)) || (e.target === nodeKey && nodes.has(e.source))) edges.set(k, e);
  return { ...base, nodes, edges };
}

interface ShowOptions {
  /** False when the recentre comes from outside the graph: pins are cleared. */
  readonly keepPins: boolean;
  readonly pushHistory?: boolean;
  readonly fit?: boolean;
  readonly expandedGroups?: ReadonlySet<string>;
  readonly discardOptimistic?: boolean;
  readonly preserveSelection?: boolean;
}

/** Makes `key` the centre and loads its neighbourhood: degree 1 first, deeper rings streamed. */
async function show(key: NodeKey, opts: ShowOptions): Promise<void> {
  const { engine, baseGraph } = get();
  if (!engine) return;
  const centreKey = nodeKeyString(key);
  if (get().options.excludedInstances?.includes(centreKey)) {
    fail(new Error("This instance is excluded. Remove its exclusion in Filters before navigating to it."));
    return;
  }
  const token = beginWork("Loading relationships…");
  const myGeneration = generation;

  let pins = opts.keepPins ? get().pins : NO_PINS;
  const pinEdges = opts.keepPins ? get().pinEdges : NO_EDGES;
  const asCentre = pins.get(centreKey);
  if (asCentre?.offset) {
    // A pin that becomes the centre sits at the centre; it gets a new offset when it stops being one.
    pins = new Map(pins);
    (pins as Map<string, Pin>).set(centreKey, { node: asCentre.node });
  }

  // Instant feedback: re-root what is already on screen.
  const optimistic = !opts.discardOptimistic && baseGraph.nodes.has(centreKey) ? reroot(baseGraph, centreKey) : undefined;
  const previousSelection = get().selection;
  const initial = opts.discardOptimistic ? centreOnly(baseGraph, centreKey) : baseGraph;
  setBase(optimistic ?? initial, pins, opts.discardOptimistic ? NO_EDGES : pinEdges, {
    pathView: undefined,
    previousCentre: get().graph.centreKey || undefined,
    selection: opts.preserveSelection ? previousSelection && { ...previousSelection } : { kind: "node", key: centreKey },
  }, !opts.discardOptimistic);
  const options = opts.pushHistory === false ? get().options : { ...get().options, expandedGroups: new Set<string>(opts.expandedGroups) };
  set({ options });

  try {
    const result = await engine.buildNeighbourhood(key, options, (partial) => {
      if (myGeneration === generation)
        setBase(mergeProgress(partial, optimistic), get().pins, undefined, {}, !opts.discardOptimistic);
    }, token);
    const settled = await settlePins(result, token, get().pins);
    if (myGeneration !== generation) return;
    setBase(result, settled.pins, settled.pinEdges, { status: { kind: "idle", message: describe(result) } });
    set((s) => ({ fitRequest: opts.fit || !optimistic ? s.fitRequest + 1 : s.fitRequest }));
    recordHistory(result, opts.pushHistory === false);
  } catch (e) {
    if (myGeneration === generation) fail(e);
  }
}

export const graphHistory = history;

function sameExclusions(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

export const filterEdits = {
  excludeClass: (name: string) => graphActions.setFilter("classes", name, "exclude"),
  excludeModel: (id: string) => graphActions.setFilter("models", id, "exclude"),
  excludeRelationship: (name: string) => graphActions.setFilter("relationships", name, "exclude"),
};
