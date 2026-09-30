import type { Census } from "./census";
import type { ClassRegistry } from "./ClassRegistry";
import { quoteClassName } from "./ecsql";
import type { Cardinality, GraphData, NodeCategory } from "./GraphModel";
import { TraversalCancelled } from "./GraphEngine";
import type { IModelQueryPort } from "./IModelQueryPort";
import { RelationshipInfoCache } from "./relationshipInfo";

/** One class observed in the iModel (or in the current neighbourhood). Keyed by `classId`. */
export interface ClassGraphNode {
  readonly key: string;
  readonly classId: string;
  /** `Schema:Class` */
  readonly className: string;
  readonly schemaName: string;
  readonly category: NodeCategory;
  readonly classHierarchy: readonly string[];
  /** Instances of exactly this class; undefined when the census does not cover the class. */
  readonly instanceCount?: number;
}

/** One observed (relationship class, source class, target class) triple with its instance count. */
export interface ClassGraphEdge {
  readonly key: string;
  /** Source and target are `classId`s ({@link ClassGraphNode} keys). */
  readonly source: string;
  readonly target: string;
  readonly relClassId: string;
  /** `Schema:Class` */
  readonly relClassName: string;
  readonly kind: "navigation" | "linkTable";
  readonly count: number;
  readonly cardinality?: Cardinality;
}

export interface ClassGraphData {
  readonly nodes: ReadonlyMap<string, ClassGraphNode>;
  readonly edges: ReadonlyMap<string, ClassGraphEdge>;
}

export function emptyClassGraph(): ClassGraphData {
  return { nodes: new Map(), edges: new Map() };
}

/** Schemas whose relationships are ECDb infrastructure, not the app's data model. */
const SYSTEM_SCHEMAS = new Set(["ECDbMeta", "ECDbSystem", "ECDbMap", "ECDbFileInfo", "ECDbSchemaPolicies"]);

const edgeKey = (relClassId: string, source: string, target: string) => `${relClassId}|${source}>${target}`;

interface Builder {
  nodes: Map<string, ClassGraphNode>;
  edges: Map<string, ClassGraphEdge>;
}

function makeNodeFactory(registry: ClassRegistry, census?: Census) {
  const counts = new Map<string, number>();
  for (const e of census?.entries ?? [])
    counts.set(e.classId, (counts.get(e.classId) ?? 0) + e.count);
  return (classId: string): ClassGraphNode => ({
    key: classId,
    classId,
    className: registry.nameOf(classId),
    schemaName: registry.nameOf(classId).split(":")[0],
    category: registry.categoryOf(classId),
    classHierarchy: registry.hierarchyOf(classId),
    instanceCount: counts.get(classId),
  });
}

/** Collapses the loaded instance graph to one node per class: an "observed schema" of what is on
 * screen. Pure and instant; aggregate ("+N more") nodes and their edges are skipped. */
export function collapseToClasses(graph: GraphData, registry: ClassRegistry, census?: Census): ClassGraphData {
  const node = makeNodeFactory(registry, census);
  const nodes = new Map<string, ClassGraphNode>();
  const shown = new Map<string, number>();
  for (const n of graph.nodes.values()) {
    if (n.aggregate)
      continue;
    if (!nodes.has(n.classId))
      nodes.set(n.classId, node(n.classId));
    shown.set(n.classId, (shown.get(n.classId) ?? 0) + 1);
  }
  // In the neighbourhood scope the count is what is actually on screen, not the census.
  for (const [id, n] of nodes)
    nodes.set(id, { ...n, instanceCount: shown.get(id) });

  const edges = new Map<string, ClassGraphEdge>();
  for (const e of graph.edges.values()) {
    if (e.kind === "aggregate")
      continue;
    const source = graph.nodes.get(e.source)?.classId;
    const target = graph.nodes.get(e.target)?.classId;
    if (!source || !target || !nodes.has(source) || !nodes.has(target))
      continue;
    const key = edgeKey(e.relClassId, source, target);
    const existing = edges.get(key);
    edges.set(key, existing
      ? { ...existing, count: existing.count + 1 }
      : {
        key, source, target, relClassId: e.relClassId, relClassName: e.relClassName,
        kind: e.kind === "navigation" ? "navigation" : "linkTable", count: 1, cardinality: e.cardinality,
      });
  }
  return { nodes, edges };
}

/** Full names of relationships that back a navigation property; instances of these (or their
 * subclasses) live in the end tables rather than a link table. */
function navBackedRelNames(registry: ClassRegistry): Set<string> {
  const names = new Set<string>();
  for (const schema of registry.view.getSchemas())
    for (const cls of schema.getClasses()) {
      if (cls.isRelationship() || (!cls.isEntity() && !cls.isMixin()))
        continue;
      for (const prop of cls.getOwnProperties())
        if (prop.isNavigation())
          names.add(prop.relationshipClass.fullName);
    }
  return names;
}

/** Root relationship classes (no relationship base class) outside the system schemas. One
 * polymorphic grouped query per root covers every subclass. */
export function relationshipRoots(registry: ClassRegistry): string[] {
  const roots: string[] = [];
  for (const schema of registry.view.getSchemas()) {
    if (SYSTEM_SCHEMAS.has(schema.name))
      continue;
    for (const cls of schema.getClasses())
      if (cls.isRelationship() && !cls.baseClass)
        roots.push(cls.fullName);
  }
  return roots.sort();
}

export interface BuildProgress {
  readonly done: number;
  readonly total: number;
}

export interface BuildClassGraphOptions {
  /** Fills node instance counts; without it every count is undefined. */
  readonly census?: Census;
  /** Called with a snapshot after each relationship root finishes. */
  readonly onProgress?: (partial: ClassGraphData, progress: BuildProgress) => void;
  readonly cancel?: { readonly cancelled: boolean };
}

const CONCURRENCY = 4;

/** Builds the whole-iModel class graph: which classes are related to which, through what, and how
 * often. One grouped query per relationship root, streamed as they land. Worst case measured at
 * ~30–60 s on a 38 GB file, so callers should cache the result per connection and offer Cancel. */
export async function buildClassGraph(port: IModelQueryPort, registry: ClassRegistry, opts: BuildClassGraphOptions = {}): Promise<ClassGraphData> {
  const roots = relationshipRoots(registry);
  const navNames = navBackedRelNames(registry);
  const infos = new RelationshipInfoCache(registry);
  const node = makeNodeFactory(registry, opts.census);
  const out: Builder = { nodes: new Map(), edges: new Map() };
  let done = 0;

  const kindOf = (relClassId: string) =>
    registry.hierarchyOf(relClassId).some((n) => navNames.has(n)) ? "navigation" as const : "linkTable" as const;

  const runRoot = async (root: string) => {
    let rows: Array<Record<string, any>>;
    try {
      rows = await port.query(
        `SELECT ECClassId Rel, SourceECClassId S, TargetECClassId T, COUNT(*) N FROM ${quoteClassName(root)} GROUP BY ECClassId, SourceECClassId, TargetECClassId`);
    } catch {
      return; // e.g. an abstract root with no instantiable subclass; nothing to report
    }
    if (opts.cancel?.cancelled)
      throw new TraversalCancelled();
    for (const r of rows) {
      if (!r.Rel || !r.S || !r.T)
        continue;
      for (const id of [r.S, r.T])
        if (!out.nodes.has(id))
          out.nodes.set(id, node(id));
      const key = edgeKey(r.Rel, r.S, r.T);
      out.edges.set(key, {
        key, source: r.S, target: r.T, relClassId: r.Rel, relClassName: registry.nameOf(r.Rel),
        kind: kindOf(r.Rel), count: Number(r.N), cardinality: infos.get(r.Rel)?.cardinality,
      });
    }
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, roots.length) }, async () => {
    while (next < roots.length) {
      if (opts.cancel?.cancelled)
        throw new TraversalCancelled();
      const root = roots[next++];
      await runRoot(root);
      done++;
      opts.onProgress?.({ nodes: new Map(out.nodes), edges: new Map(out.edges) }, { done, total: roots.length });
    }
  });
  await Promise.all(workers);
  return { nodes: out.nodes, edges: out.edges };
}
