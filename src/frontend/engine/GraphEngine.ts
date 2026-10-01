import { QueryBinder } from "@itwin/core-common";
import { ClassRegistry } from "./ClassRegistry";
import { quoteClassName } from "./ecsql";
import type { Pins } from "./pins";
import { passesClassFilters, passesModelFilters, passesRelationshipFilters, type FilterSpec, EMPTY_FILTERS } from "./filters";
import {
  aggregateKey, type DirectionFilter, parseAggregateKey, edgeKeyFor, type GraphData, type GraphEdge, type GraphNode, type NodeKey, nodeKeyString, parseNodeKey, type RawRelation,
} from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";
import { loadModels, type ModelInfo } from "./models";
import { NodeResolver } from "./resolveNodes";
import { RelationshipInfoCache } from "./relationshipInfo";
import { selectStrategy, type StrategyName, type TraversalStrategy } from "./TraversalStrategy";

export interface TraversalOptions {
  readonly depth: number;
  readonly direction: DirectionFilter;
  readonly filters: FilterSpec;
  readonly excludedInstances?: readonly string[];
  /** Hard cap on nodes; traversal stops and marks the graph truncated when reached. */
  readonly nodeBudget: number;
  /** New neighbours per (node, relationship class, direction) above which an aggregate node is shown. */
  readonly groupCap: number;
  /** Aggregate group keys the user has opened; exempt from `groupCap`. */
  readonly expandedGroups: ReadonlySet<string>;
}

export const DEFAULT_OPTIONS: TraversalOptions = {
  depth: 1, direction: "both", filters: EMPTY_FILTERS, excludedInstances: [], nodeBudget: 750, groupCap: 25, expandedGroups: new Set(),
};

export interface CancelToken {
  readonly cancelled: boolean;
}

export class TraversalCancelled extends Error {
  public constructor() { super("Traversal superseded"); }
}

interface MutableGraph {
  centreKey: string;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  truncated: boolean;
}

function toMutable(g: GraphData): MutableGraph {
  return { centreKey: g.centreKey, nodes: new Map(g.nodes), edges: new Map(g.edges), truncated: g.truncated };
}

function freeze(g: MutableGraph): GraphData {
  return { centreKey: g.centreKey, nodes: new Map(g.nodes), edges: new Map(g.edges), truncated: g.truncated };
}

export { aggregateKey };

/** Everything the UI needs for one open iModel. Runs entirely on the frontend `IModelConnection`
 * (or a backend `IModelDb` in tests) through {@link IModelQueryPort}. */
export class GraphEngine {
  private constructor(
    public readonly port: IModelQueryPort,
    public readonly registry: ClassRegistry,
    public readonly relationships: RelationshipInfoCache,
    public readonly resolver: NodeResolver,
    public readonly strategy: TraversalStrategy,
    public readonly models: readonly ModelInfo[],
  ) {
    this._modelParents = new Map(models.map((m) => [m.id, m.parentId]));
  }

  private readonly _modelParents: ReadonlyMap<string, string | undefined>;
  private readonly _parentOf = (modelId: string) => this._modelParents.get(modelId);

  public static async create(port: IModelQueryPort, prefer?: StrategyName): Promise<GraphEngine> {
    const registry = await ClassRegistry.create(port);
    const strategy = await selectStrategy(port, registry, prefer);
    const models = await loadModels(port, registry);
    return new GraphEngine(port, registry, new RelationshipInfoCache(registry), new NodeResolver(port, registry), strategy, models);
  }

  public withStrategy(strategy: TraversalStrategy): GraphEngine {
    return new GraphEngine(this.port, this.registry, this.relationships, this.resolver, strategy, this.models);
  }

  /** The centre plus `depth` hops, one frontier at a time so filters apply between hops and each
   * completed ring can be shown while the next loads. */
  public async buildNeighbourhood(centre: NodeKey, opts: TraversalOptions, onProgress?: (g: GraphData) => void, cancel?: CancelToken): Promise<GraphData> {
    const centreKey = nodeKeyString(centre);
    if (opts.excludedInstances?.includes(centreKey))
      throw new Error("This instance is excluded. Remove its exclusion in Filters before navigating to it.");
    const resolved = await this.resolver.resolve([centre]);
    this._checkCancelled(cancel);
    const g: MutableGraph = { centreKey, nodes: new Map(), edges: new Map(), truncated: false };
    g.nodes.set(centreKey, { ...resolved.get(centreKey)!, depth: 0, expanded: false });

    let frontier = [centreKey];
    for (let d = 0; d < opts.depth && frontier.length > 0 && !g.truncated; d++) {
      frontier = await this._expandFrontier(g, frontier, opts, cancel);
      onProgress?.(freeze(g));
    }
    return freeze(g);
  }

  /** Adds one hop around `nodeKey`, keeping everything already present. */
  public async expand(graph: GraphData, nodeKey: string, opts: TraversalOptions, cancel?: CancelToken): Promise<GraphData> {
    if (opts.excludedInstances?.includes(nodeKey)) throw new Error("Cannot expand an excluded instance");
    const g = toMutable(graph);
    if (!g.nodes.has(nodeKey))
      return graph;
    g.truncated = false;
    await this._expandFrontier(g, [nodeKey], opts, cancel);
    return freeze(g);
  }

  /** Replaces an aggregate node with the neighbours it stood for. */
  public async openAggregate(graph: GraphData, aggKey: string, opts: TraversalOptions, cancel?: CancelToken): Promise<{ graph: GraphData; expandedGroups: Set<string> }> {
    const agg = graph.nodes.get(aggKey)?.aggregate;
    const expandedGroups = new Set(opts.expandedGroups);
    if (!agg)
      return { graph, expandedGroups };
    expandedGroups.add(aggKey);
    const g = toMutable(graph);
    g.nodes.delete(aggKey);
    for (const [k, e] of g.edges)
      if (e.source === aggKey || e.target === aggKey) g.edges.delete(k);
    await this._expandFrontier(g, [agg.ownerKey], { ...opts, expandedGroups }, cancel);
    return { graph: freeze(g), expandedGroups };
  }

  /** Edges between pinned nodes and everything displayed (the traversal result and other pins),
   * not already in `base`. Never adds nodes. Both directions are searched: a pin is explicit, so
   * its links are shown whatever the traversal direction. */
  public async connectPinned(base: GraphData, pins: Pins, opts: TraversalOptions, cancel?: CancelToken): Promise<Map<string, GraphEdge>> {
    const out = new Map<string, GraphEdge>();
    const excluded = new Set(opts.excludedInstances);
    const seeds = [...pins.values()].filter((p) => !p.node.aggregate && !excluded.has(p.node.key)).map((p) => parseNodeKey(p.node.key));
    if (seeds.length === 0) return out;
    const targets = new Map<string, NodeKey>();
    for (const n of base.nodes.values()) if (!n.aggregate && !excluded.has(n.key)) targets.set(n.key, { id: n.id, classId: n.classId });
    for (const s of seeds) targets.set(nodeKeyString(s), s);
    const rels = await this.strategy.linksBetween(seeds, [...targets.values()], "both");
    this._checkCancelled(cancel);
    for (const r of rels) {
      const { key, source, target } = edgeKeyFor(r);
      if (base.edges.has(key) || out.has(key) || !targets.has(source) || !targets.has(target)) continue;
      if (!passesRelationshipFilters(opts.filters, this.registry.hierarchyOf(r.relClassId))) continue;
      out.set(key, this._edgeFor(r, key, source, target));
    }
    return out;
  }

  /** Keys of instances that still exist, e.g. before restoring pins from a saved session. */
  public async existingKeys(keys: readonly NodeKey[]): Promise<Set<string>> {
    const out = new Set<string>();
    await Promise.all(keys.map(async (k) => {
      const name = this.registry.nameOf(k.classId);
      if (!name || !name.includes(":")) return;
      try {
        const rows = await this.port.query(`SELECT ECInstanceId FROM ${quoteClassName(name)} WHERE ECInstanceId = ? AND ECClassId = ?`,
          new QueryBinder().bindId(1, k.id).bindId(2, k.classId));
        if (rows.length > 0) out.add(nodeKeyString(k));
      } catch { /* unknown or unqueryable class: treat as gone */ }
    }));
    return out;
  }

  /** Removes nodes that are only reachable from the centre through `nodeKey`. */
  public collapse(graph: GraphData, nodeKey: string): GraphData {
    if (nodeKey === graph.centreKey) {
      const centre = graph.nodes.get(nodeKey)!;
      return { ...graph, nodes: new Map([[nodeKey, { ...centre, expanded: false }]]), edges: new Map(), truncated: false };
    }
    const adjacency = new Map<string, string[]>();
    for (const e of graph.edges.values()) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, []);
      if (!adjacency.has(e.target)) adjacency.set(e.target, []);
      adjacency.get(e.source)!.push(e.target);
      adjacency.get(e.target)!.push(e.source);
    }
    const node = graph.nodes.get(nodeKey);
    // Keep the edge(s) back towards the centre: neighbours with a smaller depth.
    const keep = new Set<string>([graph.centreKey]);
    const queue = [graph.centreKey];
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (k === nodeKey) continue;
      for (const n of adjacency.get(k) ?? []) {
        if (!keep.has(n)) { keep.add(n); queue.push(n); }
      }
    }
    const nodes = new Map<string, GraphNode>();
    for (const [k, n] of graph.nodes)
      if (keep.has(k)) nodes.set(k, k === nodeKey ? { ...n, expanded: false } : n);
    const edges = new Map<string, GraphEdge>();
    for (const [k, e] of graph.edges) {
      if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
      // Drop edges from the collapsed node out to nodes further from the centre.
      const other = e.source === nodeKey ? e.target : e.target === nodeKey ? e.source : undefined;
      if (other && node && (nodes.get(other)!.depth > node.depth)) continue;
      edges.set(k, e);
    }
    // Nodes that lost their only edge to the collapsed node are now disconnected.
    const connected = new Set<string>([graph.centreKey]);
    for (const e of edges.values()) { connected.add(e.source); connected.add(e.target); }
    for (const k of [...nodes.keys()])
      if (!connected.has(k)) nodes.delete(k);
    return { centreKey: graph.centreKey, nodes, edges, truncated: false };
  }

  private _checkCancelled(cancel?: CancelToken) {
    if (cancel?.cancelled)
      throw new TraversalCancelled();
  }

  /** Queries every frontier node, applies filters, groups oversized fans into aggregate nodes,
   * enforces the budget and resolves new nodes. Returns the newly added node keys. */
  private async _expandFrontier(g: MutableGraph, frontierKeys: string[], opts: TraversalOptions, cancel?: CancelToken): Promise<string[]> {
    const excluded = new Set(opts.excludedInstances);
    const seeds = frontierKeys.filter((key) => !excluded.has(key)).map(parseNodeKey);
    if (seeds.length === 0) return [];
    const knownIds = new Set<string>();
    for (const n of g.nodes.values()) if (!n.aggregate) knownIds.add(n.id);
    const { relations: raw, totals } = await this.strategy.neighbours(seeds, opts.direction, {
      fetchLimit: opts.groupCap * 2 + 10,
      maxRows: Math.max(opts.nodeBudget * 2, opts.groupCap * 2 + 10),
      unlimited: opts.expandedGroups,
      knownIds: [...knownIds],
      excludedInstances: opts.excludedInstances,
    });
    this._checkCancelled(cancel);

    for (const k of frontierKeys) {
      const n = g.nodes.get(k);
      if (n) g.nodes.set(k, { ...n, expanded: true });
    }

    const passesClass = new Map<string, boolean>();
    const classOk = (classId: string) => {
      let ok = passesClass.get(classId);
      if (ok === undefined) {
        ok = passesClassFilters(opts.filters, this.registry.hierarchyOf(classId));
        passesClass.set(classId, ok);
      }
      return ok;
    };

    // Group relations that would introduce new nodes, so large fans can be summarised.
    const toExisting: RawRelation[] = [];
    const groups = new Map<string, RawRelation[]>();
    const seenEdge = new Set<string>();
    /** Per capped group: rows fetched that lead to instances already on the graph. */
    const existingInGroup = new Map<string, number>();
    for (const r of raw) {
      const relatedKey = nodeKeyString(r.related);
      if (excluded.has(relatedKey)) continue;
      const gk = aggregateKey(nodeKeyString(r.seed), r.relClassId, r.direction);
      const { key: edgeKey } = edgeKeyFor(r);
      if (seenEdge.has(edgeKey)) continue;
      seenEdge.add(edgeKey);
      if (g.nodes.has(relatedKey) && totals.has(gk))
        existingInGroup.set(gk, (existingInGroup.get(gk) ?? 0) + 1);
      if (g.edges.has(edgeKey)) continue;
      if (!passesRelationshipFilters(opts.filters, this.registry.hierarchyOf(r.relClassId))) continue;
      if (g.nodes.has(relatedKey)) { toExisting.push(r); continue; }
      if (!classOk(r.related.classId)) continue;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push(r);
    }

    const accepted: RawRelation[] = [];
    const aggregates: Array<{ key: string; hidden: number }> = [];
    for (const [gk, rels] of groups) {
      // The same new instance may be reached through several relationships; count distinct targets.
      const distinct = new Set(rels.map((r) => nodeKeyString(r.related)));
      const shown = distinct.size > opts.groupCap && !opts.expandedGroups.has(gk) ? new Set([...distinct].slice(0, opts.groupCap)) : distinct;
      accepted.push(...(shown === distinct ? rels : rels.filter((r) => shown.has(nodeKeyString(r.related)))));
      // Capped groups were only partly fetched: the strategy's server-side count is the real total.
      const total = totals.get(gk);
      const hidden = total !== undefined ? Math.max(0, total - shown.size - (existingInGroup.get(gk) ?? 0)) : distinct.size - shown.size;
      if (hidden > 0)
        aggregates.push({ key: gk, hidden });
    }
    // Capped groups whose fetched rows all led to existing (or filtered) instances.
    for (const [gk, total] of totals) {
      if (groups.has(gk) || !passesRelationshipFilters(opts.filters, this.registry.hierarchyOf(gk.split("|")[3]))) continue;
      const hidden = total - (existingInGroup.get(gk) ?? 0);
      if (hidden > 0)
        aggregates.push({ key: gk, hidden });
    }

    // Budget: admit new instances in order until the cap is reached.
    const newKeys: NodeKey[] = [];
    const newKeySet = new Set<string>();
    let instanceCount = 0;
    for (const n of g.nodes.values()) if (!n.aggregate) instanceCount++;
    for (const r of accepted) {
      const k = nodeKeyString(r.related);
      if (newKeySet.has(k)) continue;
      if (instanceCount + newKeys.length >= opts.nodeBudget) { g.truncated = true; break; }
      newKeySet.add(k);
      newKeys.push(r.related);
    }

    const resolved = newKeys.length > 0 ? await this.resolver.resolve(newKeys) : new Map();
    this._checkCancelled(cancel);

    const depthOf = new Map<string, number>();
    for (const r of accepted) {
      const k = nodeKeyString(r.related);
      const d = (g.nodes.get(nodeKeyString(r.seed))?.depth ?? 0) + 1;
      depthOf.set(k, Math.min(depthOf.get(k) ?? d, d));
    }
    const added: string[] = [];
    for (const [k, n] of resolved) {
      if (!passesModelFilters(opts.filters, n, this._parentOf)) continue;
      g.nodes.set(k, { ...n, depth: depthOf.get(k) ?? 1, expanded: false });
      added.push(k);
    }

    for (const r of [...toExisting, ...accepted]) {
      const { key, source, target } = edgeKeyFor(r);
      if (!g.nodes.has(source) || !g.nodes.has(target)) continue;
      g.edges.set(key, this._edgeFor(r, key, source, target));
    }

    for (const a of aggregates) {
      const { ownerKey, relClassId, direction } = parseAggregateKey(a.key);
      const owner = g.nodes.get(ownerKey);
      if (!owner) continue;
      const relClassName = this.registry.nameOf(relClassId);
      g.nodes.set(a.key, {
        key: a.key, id: "", classId: "", className: relClassName, schemaName: relClassName.split(":")[0],
        label: `+${a.hidden} more`, category: "other", classHierarchy: [], depth: owner.depth + 1, expanded: false,
        aggregate: { ownerKey, relClassId, relClassName, direction, hiddenCount: a.hidden },
      });
      const [source, target] = direction === "forward" ? [ownerKey, a.key] : [a.key, ownerKey];
      g.edges.set(`${a.key}|edge`, {
        key: `${a.key}|edge`, source, target, relClassId, relClassName, relInstanceId: "", kind: "aggregate",
        cardinality: this.relationships.get(relClassId)?.cardinality,
      });
    }
    return added;
  }

  private _edgeFor(r: RawRelation, key: string, source: string, target: string): GraphEdge {
    return {
      key, source, target,
      relClassId: r.relClassId,
      relClassName: this.registry.nameOf(r.relClassId),
      relInstanceId: r.relInstanceId,
      kind: r.navPropertyName ? "navigation" : "linkTable",
      navPropertyName: r.navPropertyName,
      cardinality: this.relationships.get(r.relClassId)?.cardinality,
    };
  }
}

export { EMPTY_FILTERS };
