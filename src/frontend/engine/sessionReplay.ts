import type { SavedSession } from "../services/sessionStore";
import { type CancelToken, type GraphEngine, TraversalCancelled, type TraversalOptions } from "./GraphEngine";
import { type GraphData, type GraphEdge, nodeKeyString, normalizeExcludedInstances, parseNodeKey } from "./GraphModel";
import { composeDisplay, type Pin, type Pins, prunePinEdges, retainPins } from "./pins";

/** The traversal options a session asks for, keeping settings it does not store from `current`. */
export function sessionOptions(session: SavedSession, current: TraversalOptions): TraversalOptions {
  const excludedInstances = normalizeExcludedInstances(session.excludedInstances);
  if (excludedInstances.includes(nodeKeyString(session.centre)))
    throw new Error("Session excludes its own centre instance");
  return {
    ...current, depth: session.depth, direction: session.direction, filters: session.filters, excludedInstances,
    nodeBudget: session.nodeBudget, groupCap: session.groupCap, expandedGroups: new Set(session.expandedGroups),
  };
}

/** Re-links pins to a traversal result and drops the ones no longer connected. `fallback` edges are
 * kept when looking up links fails, unless instances are excluded (a stale edge could show one). */
export async function settlePins(engine: GraphEngine | undefined, base: GraphData, pins: Pins, options: TraversalOptions, token: CancelToken,
  fallback: ReadonlyMap<string, GraphEdge> = new Map(), extraEdges: Iterable<GraphEdge> = []): Promise<{ pins: Pins; pinEdges: Map<string, GraphEdge> }> {
  const excluded = new Set(options.excludedInstances);
  pins = new Map([...pins].filter(([key]) => !excluded.has(key)));
  const candidates = new Map<string, GraphEdge>();
  for (const e of extraEdges) candidates.set(e.key, e);
  if (pins.size === 0) return { pins, pinEdges: new Map() };
  try {
    if (engine) for (const [k, e] of await engine.connectPinned(base, pins, options, token)) candidates.set(k, e);
  } catch (e) {
    if (e instanceof TraversalCancelled || excluded.size > 0) throw e;
    for (const [k, edge] of fallback) candidates.set(k, edge); // best effort: keep what we knew
  }
  const kept = retainPins(base, pins, candidates);
  return { pins: kept, pinEdges: prunePinEdges(base, kept, candidates) };
}

/** Expanding a pin that is outside the traversal result first brings it (and its links) into it. */
export function absorbPin(base: GraphData, pins: Pins, pinEdges: ReadonlyMap<string, GraphEdge>, nodeKey: string): GraphData {
  if (base.nodes.has(nodeKey) || !pins.has(nodeKey)) return base;
  const display = composeDisplay(base, pins, pinEdges);
  const nodes = new Map(base.nodes);
  nodes.set(nodeKey, display.nodes.get(nodeKey)!);
  const edges = new Map(base.edges);
  for (const [k, e] of pinEdges)
    if ((e.source === nodeKey && nodes.has(e.target)) || (e.target === nodeKey && nodes.has(e.source))) edges.set(k, e);
  return { ...base, nodes, edges };
}

export interface ReplayedSession {
  readonly options: TraversalOptions;
  readonly base: GraphData;
  readonly pins: Pins;
  readonly pinEdges: ReadonlyMap<string, GraphEdge>;
}

/** Rebuilds a session's graph on `engine` without touching any UI state: centre and options, then
 * pins (skipping instances that no longer exist or are excluded), then manual expansions in order.
 * The graph store's restore and the session diff both use this, so they always agree. */
export async function replaySession(engine: GraphEngine, session: SavedSession, current: TraversalOptions, token: CancelToken,
  onProgress?: (partial: GraphData) => void): Promise<ReplayedSession> {
  const options = sessionOptions(session, current);
  const excluded = new Set(options.excludedInstances);
  let base = await engine.buildNeighbourhood(session.centre, options, onProgress, token);
  let pins: Pins = new Map();
  let pinEdges: ReadonlyMap<string, GraphEdge> = new Map();
  if (session.pinned && session.pinned.length > 0) {
    const keys = session.pinned.filter((p) => !excluded.has(p.key)).map((p) => parseNodeKey(p.key));
    const existing = await engine.existingKeys(keys);
    const resolved = await engine.resolver.resolve(keys.filter((k) => existing.has(nodeKeyString(k))));
    const wanted = new Map<string, Pin>();
    for (const p of session.pinned) {
      const n = resolved.get(p.key);
      if (n) wanted.set(p.key, { node: { ...n, depth: 0, expanded: false }, offset: p.offset });
    }
    ({ pins, pinEdges } = await settlePins(engine, base, wanted, options, token));
  }
  for (const k of session.expandedNodes) {
    const n = composeDisplay(base, pins, pinEdges).nodes.get(k);
    if (!n || n.expanded) continue;
    base = await engine.expand(absorbPin(base, pins, pinEdges, k), k, options, token);
    ({ pins, pinEdges } = await settlePins(engine, base, pins, options, token, pinEdges));
  }
  return { options, base, pins, pinEdges };
}
