import ElkApi, { type ELK } from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { GraphData } from "../engine/GraphModel";

export interface Point { x: number; y: number }
export type Positions = Map<string, Point>;
export type LayoutMode = "radial" | "layered";

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 64;
const RING_GAP = 280;
const ARC_PADDING = 24;
/** Mean tangential footprint of a node box over all bearings, plus padding: sizes rings. */
const MIN_ARC = (2 / Math.PI) * (NODE_WIDTH + NODE_HEIGHT) + ARC_PADDING;

/** Tangential footprint of a node box at bearing `a` on a ring. */
function arcFootprint(a: number): number {
  return Math.abs(NODE_WIDTH * Math.sin(a)) + Math.abs(NODE_HEIGHT * Math.cos(a)) + ARC_PADDING;
}

/** Angular gap needed between neighbours at bearings `a` and `b` on a ring of radius `r` (chord-exact). */
function angularGap(a: number, b: number, r: number): number {
  const chord = (arcFootprint(a) + arcFootprint(b)) / 2;
  return chord >= 2 * r ? Math.PI : 2 * Math.asin(chord / (2 * r));
}

/** Smallest radius at which boxes at these bearings fit around a ring without overlapping. */
export function ringRadiusFor(angles: readonly number[], minRadius: number): number {
  const sorted = [...angles].sort((x, y) => x - y);
  let r = minRadius;
  for (let i = 0; i < 40 && sorted.length > 1; i++) {
    const needed = sorted.reduce((sum, a, j) => sum + angularGap(a, sorted[(j + 1) % sorted.length], r), 0);
    if (needed <= 2 * Math.PI) break;
    r *= Math.max(1.05, needed / (2 * Math.PI));
  }
  return r;
}

/** Nudges the angles on one ring apart so neighbouring boxes don't overlap, keeping the order and
 * roughly the original bearings (leaf-weighted wedges can bunch small subtrees together).
 * Assumes `r` is at least `ringRadiusFor(angles)`; otherwise spacing is best-effort. */
export function spreadRing(angles: number[], r: number): number[] {
  const n = angles.length;
  if (n < 2 || r <= 0) return angles.slice();
  const order = angles.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a);
  const gap = (a: number, b: number) => angularGap(a, b, r);
  const out = order.map((o) => o.a);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + gap(out[i - 1], out[i]));
    // Re-centre the displacement so the ring doesn't drift one way.
    const shift = order.reduce((sum, o, i) => sum + (o.a - out[i]), 0) / n;
    for (let i = 0; i < n; i++) out[i] += shift;
    // Close the wrap-around seam by pulling the tail back towards the head.
    const limit = out[0] + 2 * Math.PI;
    if (out[n - 1] + gap(out[n - 1], out[0]) > limit) {
      out[n - 1] = limit - gap(out[n - 1], out[0]);
      for (let i = n - 2; i >= 1; i--) out[i] = Math.min(out[i], out[i + 1] - gap(out[i], out[i + 1]));
    }
  }
  const result = new Array<number>(n);
  order.forEach((o, i) => { result[o.i] = out[i]; });
  return result;
}

/** Adjacency keyed by node, with neighbours in a deterministic order. */
export function adjacencyOf(graph: GraphData): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const k of graph.nodes.keys()) adj.set(k, []);
  for (const e of graph.edges.values()) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  return adj;
}

/** BFS hop counts from `centreKey`. Unreachable nodes are absent. */
export function bfsDepths(graph: GraphData, centreKey: string): Map<string, number> {
  const adj = adjacencyOf(graph);
  const depth = new Map<string, number>([[centreKey, 0]]);
  const queue = [centreKey];
  while (queue.length > 0) {
    const k = queue.shift()!;
    for (const n of adj.get(k) ?? []) {
      if (!depth.has(n)) { depth.set(n, depth.get(k)! + 1); queue.push(n); }
    }
  }
  return depth;
}

/** Re-roots an existing graph on another node without querying: used for the instant, optimistic
 * part of a recentre while the new neighbourhood loads. */
export function reroot(graph: GraphData, centreKey: string): GraphData {
  if (!graph.nodes.has(centreKey)) return graph;
  const depths = bfsDepths(graph, centreKey);
  const max = Math.max(0, ...depths.values());
  const nodes = new Map(graph.nodes);
  for (const [k, n] of nodes) nodes.set(k, { ...n, depth: depths.get(k) ?? max + 1 });
  return { ...graph, centreKey, nodes };
}

function relationLookup(graph: GraphData): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of graph.edges.values()) {
    m.set(`${e.source}>${e.target}`, e.relClassName);
    m.set(`${e.target}>${e.source}`, e.relClassName);
  }
  return m;
}

/** Radial tree: centre at the origin, one ring per hop, each subtree in an angular wedge sized by
 * its leaf count so related instances cluster. `rotation` turns the whole layout, which keeps
 * orientation stable across recentres. Positions are node top-left corners. */
export function radialLayout(graph: GraphData, rotation = 0): Positions {
  const centre = graph.centreKey;
  const positions: Positions = new Map();
  if (!graph.nodes.has(centre)) return positions;

  const adj = adjacencyOf(graph);
  const rel = relationLookup(graph);
  const sortKey = (p: string, c: string) => {
    const n = graph.nodes.get(c);
    return `${rel.get(`${p}>${c}`) ?? ""}|${n?.className ?? ""}|${n?.label ?? ""}|${c}`;
  };
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[centre, 0]]);
  const queue = [centre];
  while (queue.length > 0) {
    const k = queue.shift()!;
    const kids: string[] = [];
    for (const n of adj.get(k) ?? []) {
      if (depth.has(n)) continue;
      depth.set(n, depth.get(k)! + 1);
      kids.push(n);
      queue.push(n);
    }
    kids.sort((a, b) => sortKey(k, a).localeCompare(sortKey(k, b)));
    children.set(k, kids);
  }
  // Nodes disconnected from the centre (possible after collapse/filter) go on an outer ring.
  const orphans = [...graph.nodes.keys()].filter((k) => !depth.has(k)).sort();

  const leaves = new Map<string, number>();
  const countLeaves = (k: string): number => {
    const kids = children.get(k) ?? [];
    const v = kids.length === 0 ? 1 : kids.reduce((s, c) => s + countLeaves(c), 0);
    leaves.set(k, v);
    return v;
  };
  countLeaves(centre);

  const perRing = new Map<number, number>();
  for (const d of depth.values()) perRing.set(d, (perRing.get(d) ?? 0) + 1);
  const maxDepth = Math.max(0, ...perRing.keys());
  const radius: number[] = [0];
  for (let d = 1; d <= maxDepth + 1; d++) {
    const count = d <= maxDepth ? perRing.get(d)! : orphans.length;
    radius[d] = Math.max(radius[d - 1] + RING_GAP, (count * MIN_ARC) / (2 * Math.PI));
  }

  const angle = new Map<string, number>();
  const assign = (k: string, a0: number, a1: number) => {
    angle.set(k, (a0 + a1) / 2);
    const kids = children.get(k) ?? [];
    const total = kids.reduce((s, c) => s + leaves.get(c)!, 0);
    let a = a0;
    for (const c of kids) {
      const span = ((a1 - a0) * leaves.get(c)!) / total;
      assign(c, a, a + span);
      a += span;
    }
  };
  assign(centre, rotation, rotation + 2 * Math.PI);

  const rings = new Map<number, string[]>();
  for (const [k, d] of depth) if (d > 0) rings.set(d, [...(rings.get(d) ?? []), k]);
  for (let d = 1; d <= maxDepth; d++) {
    const keys = rings.get(d) ?? [];
    const angles = keys.map((k) => angle.get(k)!);
    radius[d] = Math.max(radius[d], radius[d - 1] + RING_GAP, ringRadiusFor(angles, radius[d]));
    const spread = spreadRing(angles, radius[d]);
    keys.forEach((k, i) => angle.set(k, spread[i]));
  }

  for (const [k, d] of depth) {
    const a = d === 0 ? 0 : angle.get(k)!;
    positions.set(k, { x: radius[d] * Math.cos(a) - NODE_WIDTH / 2, y: radius[d] * Math.sin(a) - NODE_HEIGHT / 2 });
  }
  radius[maxDepth + 1] = Math.max(radius[maxDepth + 1], radius[maxDepth] + RING_GAP);
  orphans.forEach((k, i) => {
    const a = rotation + (2 * Math.PI * i) / orphans.length;
    positions.set(k, { x: radius[maxDepth + 1] * Math.cos(a) - NODE_WIDTH / 2, y: radius[maxDepth + 1] * Math.sin(a) - NODE_HEIGHT / 2 });
  });
  return positions;
}

/** Rotation that puts `anchorKey` on the same bearing from the new centre as it had before, so a
 * recentre reads as the camera moving rather than the graph spinning. */
export function stableRotation(graph: GraphData, previous: Positions, anchorKey: string | undefined): number {
  if (!anchorKey || anchorKey === graph.centreKey) return 0;
  const from = previous.get(graph.centreKey);
  const to = previous.get(anchorKey);
  if (!from || !to) return 0;
  const wanted = Math.atan2(to.y - from.y, to.x - from.x);
  const unrotated = radialLayout(graph, 0).get(anchorKey);
  if (!unrotated) return 0;
  const current = Math.atan2(unrotated.y + NODE_HEIGHT / 2, unrotated.x + NODE_WIDTH / 2);
  return wanted - current;
}

/** Shifts positions so the centre node sits at the origin. */
export function centreOnOrigin(graph: GraphData, positions: Positions): Positions {
  const c = positions.get(graph.centreKey);
  if (!c) return positions;
  const dx = -NODE_WIDTH / 2 - c.x;
  const dy = -NODE_HEIGHT / 2 - c.y;
  const out: Positions = new Map();
  for (const [k, p] of positions) out.set(k, { x: p.x + dx, y: p.y + dy });
  return out;
}

let elk: ELK | undefined;

/** elkjs runs its GWT-compiled engine in its own classic worker; the API object lives here. */
function getElk(): ELK {
  // The UMD bundle may surface as the constructor or as a namespace depending on CJS interop.
  const Ctor = ((ElkApi as unknown as { default?: typeof ElkApi }).default ?? ElkApi);
  elk ??= new Ctor({ workerFactory: () => new Worker(elkWorkerUrl) });
  return elk;
}

/** Layered (Sugiyama) layout via elkjs off the main thread, re-centred on the centre node. */
export async function layeredLayout(graph: GraphData): Promise<Positions> {
  const result = await getElk().layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.separateConnectedComponents": "true",
    },
    children: [...graph.nodes.keys()].map((id) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: [...graph.edges.values()].map((e) => ({ id: e.key, sources: [e.source], targets: [e.target] })),
  });
  const positions: Positions = new Map((result.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return centreOnOrigin(graph, positions);
}

export async function computeLayout(graph: GraphData, mode: LayoutMode, previous: Positions, previousCentre: string | undefined): Promise<Positions> {
  if (mode === "layered")
    return layeredLayout(graph);
  return radialLayout(graph, stableRotation(graph, previous, previousCentre));
}

const PIN_PADDING = 16;
const PUSH_STEP = 24;
const MAX_PUSH_STEPS = 400;

/** Moves nodes off pinned nodes: pins keep their place (except off the centre, which never moves),
 * and any other node overlapping a pin, or a node already pushed, slides outward along its ray
 * from the centre until it is clear. Unpinned layouts are returned unchanged. */
export function avoidPinned(positions: Positions, pinned: ReadonlySet<string>, centreKey: string): Positions {
  const c = positions.get(centreKey);
  const pins = [...pinned].filter((k) => k !== centreKey && positions.has(k));
  if (!c || pins.length === 0) return positions;
  const out: Positions = new Map(positions);
  const hits = (p: Point, o: Point, pad: number) => Math.abs(p.x - o.x) < NODE_WIDTH + pad && Math.abs(p.y - o.y) < NODE_HEIGHT + pad;
  const clearOf = (k: string, obstacles: ReadonlyArray<{ p: Point; pad: number }>) => {
    let p = out.get(k)!;
    let dx = p.x - c.x, dy = p.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    let moved = false;
    for (let i = 0; i < MAX_PUSH_STEPS && obstacles.some((o) => hits(p, o.p, o.pad)); i++) {
      p = { x: p.x + dx * PUSH_STEP, y: p.y + dy * PUSH_STEP };
      moved = true;
    }
    out.set(k, p);
    return moved;
  };

  const placed: Array<{ p: Point; pad: number }> = [{ p: c, pad: PIN_PADDING }];
  for (const k of pins) {
    clearOf(k, placed);
    placed.push({ p: out.get(k)!, pad: PIN_PADDING });
  }
  const pinSet = new Set(pins);
  const dist = (k: string) => Math.hypot(out.get(k)!.x - c.x, out.get(k)!.y - c.y);
  const rest = [...out.keys()].filter((k) => k !== centreKey && !pinSet.has(k)).sort((a, b) => dist(a) - dist(b));
  for (const k of rest) {
    clearOf(k, placed);
    // Other nodes only need to avoid exact overlap; the layout already spaced them.
    placed.push({ p: out.get(k)!, pad: 0 });
  }
  return out;
}
