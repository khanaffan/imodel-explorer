import type { GraphData, GraphEdge, GraphNode } from "./GraphModel";

export type DiffStatus = "added" | "removed" | "same";

export interface GraphDiff {
  /** Both graphs together, centred on `after`'s centre. Aggregates are left out: they summarise
   * hidden instances, so whether one "changed" says nothing about the instances themselves. */
  readonly graph: GraphData;
  readonly nodes: ReadonlyMap<string, DiffStatus>;
  readonly edges: ReadonlyMap<string, DiffStatus>;
  readonly counts: Readonly<Record<"nodes" | "edges", Readonly<Record<DiffStatus, number>>>>;
}

/** Compares two graphs by node key (`classId:id`) and edge key: what `after` adds to `before`,
 * what it no longer has, and what both share. */
export function diffGraphs(before: GraphData, after: GraphData): GraphDiff {
  const instances = (g: GraphData) => new Map([...g.nodes].filter(([, n]) => !n.aggregate));
  const a = instances(before), b = instances(after);
  const nodes = new Map<string, GraphNode>();
  const nodeStatus = new Map<string, DiffStatus>();
  for (const [k, n] of b) { nodes.set(k, n); nodeStatus.set(k, a.has(k) ? "same" : "added"); }
  for (const [k, n] of a) if (!b.has(k)) { nodes.set(k, { ...n, expanded: false }); nodeStatus.set(k, "removed"); }

  const edges = new Map<string, GraphEdge>();
  const edgeStatus = new Map<string, DiffStatus>();
  const keep = (e: GraphEdge) => nodes.has(e.source) && nodes.has(e.target);
  for (const [k, e] of after.edges) if (keep(e)) { edges.set(k, e); edgeStatus.set(k, before.edges.has(k) ? "same" : "added"); }
  for (const [k, e] of before.edges) if (keep(e) && !after.edges.has(k)) { edges.set(k, e); edgeStatus.set(k, "removed"); }

  const count = (m: ReadonlyMap<string, DiffStatus>) => {
    const c = { added: 0, removed: 0, same: 0 };
    for (const s of m.values()) c[s]++;
    return c;
  };
  return {
    graph: { centreKey: after.centreKey, nodes, edges, truncated: before.truncated || after.truncated },
    nodes: nodeStatus, edges: edgeStatus, counts: { nodes: count(nodeStatus), edges: count(edgeStatus) },
  };
}
