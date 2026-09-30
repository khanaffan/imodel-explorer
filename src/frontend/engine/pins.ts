import type { GraphData, GraphEdge, GraphNode } from "./GraphModel";

export interface PinOffset { readonly x: number; readonly y: number }

/** A node the user asked to keep in view across recentres. */
export interface Pin {
  readonly node: GraphNode;
  /** Position relative to the centre node, so the pin keeps its place on screen when the camera
   * follows a new centre. Unset until the canvas first places it. */
  readonly offset?: PinOffset;
}

export type Pins = ReadonlyMap<string, Pin>;

/** The displayed graph: the traversal result plus pinned nodes that are not part of it, and the
 * edges linking pins to what is shown. Pins are an overlay; traversal never sees them. */
export function composeDisplay(base: GraphData, pins: Pins, pinEdges: ReadonlyMap<string, GraphEdge>): GraphData {
  if (pins.size === 0) return base;
  const nodes = new Map(base.nodes);
  let maxDepth = 0;
  for (const n of base.nodes.values()) maxDepth = Math.max(maxDepth, n.depth);
  for (const [k, p] of pins)
    if (!nodes.has(k)) nodes.set(k, { ...p.node, depth: maxDepth + 1, expanded: false });
  const edges = new Map(base.edges);
  for (const [k, e] of pinEdges)
    if (!edges.has(k) && nodes.has(e.source) && nodes.has(e.target)) edges.set(k, e);
  return { ...base, nodes, edges };
}

/** Pins that stay: those in the traversal result, plus those linked to the centre or to another
 * staying pin by a direct relationship, transitively. Links to ordinary graph nodes don't count. */
export function retainPins(base: GraphData, pins: Pins, pinEdges: ReadonlyMap<string, GraphEdge>): Pins {
  if (pins.size === 0) return pins;
  const kept = new Set<string>();
  const queue: string[] = [];
  const anchor = (k: string) => { if (!kept.has(k)) { kept.add(k); queue.push(k); } };
  if (base.centreKey) anchor(base.centreKey);
  for (const k of pins.keys()) if (base.nodes.has(k)) anchor(k);

  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a)!.push(b); };
  for (const e of [...base.edges.values(), ...pinEdges.values()]) { link(e.source, e.target); link(e.target, e.source); }
  while (queue.length > 0) {
    const k = queue.shift()!;
    for (const n of adjacency.get(k) ?? []) if (pins.has(n)) anchor(n);
  }
  let changed = false;
  const out = new Map<string, Pin>();
  for (const [k, p] of pins) { if (kept.has(k)) out.set(k, p); else changed = true; }
  return changed ? out : pins;
}

/** Pin edges whose pinned end survived and whose other end is displayed. */
export function prunePinEdges(base: GraphData, pins: Pins, pinEdges: ReadonlyMap<string, GraphEdge>): Map<string, GraphEdge> {
  const shown = (k: string) => base.nodes.has(k) || pins.has(k);
  const out = new Map<string, GraphEdge>();
  for (const [k, e] of pinEdges)
    if ((pins.has(e.source) || pins.has(e.target)) && shown(e.source) && shown(e.target) && !base.edges.has(k)) out.set(k, e);
  return out;
}
