import type { IModelConnection } from "@itwin/core-frontend";
import { create } from "zustand";
import { type CancelToken, DEFAULT_OPTIONS, GraphEngine, TraversalCancelled, type TraversalOptions } from "../engine/GraphEngine";
import { emptyGraph, type GraphData, type GraphEdge, type NodeKey, nodeKeyString, parseNodeKey } from "../engine/GraphModel";
import { composeDisplay, type Pin, type PinOffset, type Pins, prunePinEdges, retainPins } from "../engine/pins";
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

/** Sets the traversal result and pins together, deriving the displayed graph. */
function setBase(baseGraph: GraphData, pins: Pins = get().pins, pinEdges: ReadonlyMap<string, GraphEdge> = get().pinEdges, extra: Partial<GraphState> = {}) {
  set({ ...extra, baseGraph, pins, pinEdges, graph: composeDisplay(baseGraph, pins, pinEdges) });
}

/** Re-links pins to a new traversal result and drops the ones no longer connected. */
async function settlePins(base: GraphData, token: CancelToken, pins: Pins = get().pins, extraEdges: Iterable<GraphEdge> = []): Promise<{ pins: Pins; pinEdges: Map<string, GraphEdge> }> {
  const candidates = new Map<string, GraphEdge>();
  for (const e of extraEdges) candidates.set(e.key, e);
  if (pins.size === 0) return { pins, pinEdges: new Map() };
  const engine = get().engine;
  try {
    if (engine) for (const [k, e] of await engine.connectPinned(base, pins, get().options, token)) candidates.set(k, e);
  } catch (e) {
    if (e instanceof TraversalCancelled) throw e;
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
  const { pins, pinEdges } = get();
  const entry = { centreKey: graph.centreKey, label: centre?.label ?? graph.centreKey, graph, expandedGroups: new Set(get().options.expandedGroups), pins, pinEdges };
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
    beginWork("Reading schemas…");
    history.clear();
    set({ connection, fileName, engine: undefined, graph: emptyGraph(), baseGraph: emptyGraph(), pins: NO_PINS, pinEdges: NO_EDGES, selection: undefined, models: [], options: { ...get().options, expandedGroups: new Set() } });
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
    set({ connection: undefined, fileName: undefined, engine: undefined, graph: emptyGraph(), baseGraph: emptyGraph(), pins: NO_PINS, pinEdges: NO_EDGES, selection: undefined, models: [], status: { kind: "idle" } });
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

  /** Recentres from outside the graph (seed query, 3D view, trees): starts over, clearing pins. */
  async seedExternal(key: NodeKey, opts: { fit?: boolean } = {}): Promise<void> {
    await show(key, { keepPins: false, fit: opts.fit });
  },

  async refresh(): Promise<void> {
    const centre = get().graph.centreKey;
    if (centre) await show(parseNodeKey(centre), { pushHistory: false, fit: true, keepPins: true });
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
    if (!node || node.aggregate) return;
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
    await show(session.centre, { fit: true, expandedGroups: options.expandedGroups, keepPins: false });
    const engine = get().engine;
    if (engine && session.pinned && session.pinned.length > 0 && get().graph.centreKey === nodeKeyString(session.centre)) {
      const token = beginWork("Restoring pins…");
      const myGeneration = generation;
      try {
        const keys = session.pinned.map((p) => parseNodeKey(p.key));
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
}

/** Makes `key` the centre and loads its neighbourhood: degree 1 first, deeper rings streamed. */
async function show(key: NodeKey, opts: ShowOptions): Promise<void> {
  const { engine, baseGraph } = get();
  if (!engine) return;
  const centreKey = nodeKeyString(key);
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
  const optimistic = baseGraph.nodes.has(centreKey) ? reroot(baseGraph, centreKey) : undefined;
  setBase(optimistic ?? baseGraph, pins, pinEdges, {
    previousCentre: get().graph.centreKey || undefined,
    selection: { kind: "node", key: centreKey },
  });
  const options = opts.pushHistory === false ? get().options : { ...get().options, expandedGroups: new Set<string>(opts.expandedGroups) };
  set({ options });

  try {
    const result = await engine.buildNeighbourhood(key, options, (partial) => {
      if (myGeneration === generation)
        setBase(mergeProgress(partial, optimistic));
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
