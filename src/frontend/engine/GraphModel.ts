/** An `ECInstanceId` / `ECClassId` pair. Both are required: ids are only unique per table, so a
 * `PhysicalPartition` and the `PhysicalModel` that models it share an id but are different nodes. */
export interface NodeKey {
  readonly id: string;
  readonly classId: string;
}

export function nodeKeyString(key: NodeKey): string {
  return `${key.classId}:${key.id}`;
}

export function parseNodeKey(key: string): NodeKey {
  const [classId, id] = key.split(":");
  return { classId, id };
}

export type Direction = "forward" | "backward";
export type DirectionFilter = Direction | "both";

export type NodeCategory =
  | "geometric3d"
  | "geometric2d"
  | "definition"
  | "information"
  | "role"
  | "model"
  | "aspect"
  | "other";

export const NODE_CATEGORIES: readonly NodeCategory[] = [
  "geometric3d", "geometric2d", "definition", "information", "role", "model", "aspect", "other",
];

export interface GraphNode {
  readonly key: string;
  readonly id: string;
  readonly classId: string;
  /** `Schema:Class` */
  readonly className: string;
  readonly schemaName: string;
  readonly label: string;
  readonly category: NodeCategory;
  /** Full names of the class and all its base classes/mixins; used by colour rules and filters. */
  readonly classHierarchy: readonly string[];
  readonly modelId?: string;
  readonly modelName?: string;
  /** Hops from the centre. */
  depth: number;
  /** True once this node's relationships have been queried. */
  expanded: boolean;
  /** Present on synthetic nodes standing in for relationships that were not loaded. */
  readonly aggregate?: AggregateInfo;
}

export interface AggregateInfo {
  readonly ownerKey: string;
  readonly relClassId: string;
  readonly relClassName: string;
  readonly direction: Direction;
  readonly hiddenCount: number;
}

export type EdgeKind = "navigation" | "linkTable" | "aggregate";

export interface Cardinality {
  readonly source: string;
  readonly target: string;
}

export interface GraphEdge {
  readonly key: string;
  readonly source: string;
  readonly target: string;
  readonly relClassId: string;
  /** `Schema:Class` */
  readonly relClassName: string;
  readonly relInstanceId: string;
  readonly kind: EdgeKind;
  readonly navPropertyName?: string;
  readonly cardinality?: Cardinality;
}

export interface GraphData {
  readonly centreKey: string;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: ReadonlyMap<string, GraphEdge>;
  /** Set when the node budget stopped traversal early. */
  readonly truncated: boolean;
}

export function emptyGraph(centreKey = ""): GraphData {
  return { centreKey, nodes: new Map(), edges: new Map(), truncated: false };
}

/** A related instance reported by a traversal strategy, before display resolution. */
export interface RawRelation {
  readonly seed: NodeKey;
  readonly related: NodeKey;
  /** `forward` when the seed is the relationship source. */
  readonly direction: Direction;
  readonly relClassId: string;
  readonly relInstanceId: string;
  /** Set for end-table (navigation property) relationships; absent for link tables. */
  readonly navPropertyName?: string;
}

export function edgeKeyFor(r: RawRelation): { key: string; source: string; target: string } {
  const seed = nodeKeyString(r.seed);
  const related = nodeKeyString(r.related);
  const [source, target] = r.direction === "forward" ? [seed, related] : [related, seed];
  // For navigation relationships RelationshipECInstanceId is the id of the element holding the
  // property, so the endpoints are part of the identity; the same key is produced from either end.
  return { key: `${r.relClassId}:${r.relInstanceId}:${source}>${target}`, source, target };
}

/** Identity of a (owner, relationship class, direction) group; also the key of its "+N" summary node. */
export function aggregateKey(ownerKey: string, relClassId: string, direction: string): string {
  return `agg|${ownerKey}|${relClassId}|${direction}`;
}

export function parseAggregateKey(key: string): { ownerKey: string; relClassId: string; direction: Direction } {
  // agg|<classId:instanceId>|<relClassId>|<direction>
  const [, ownerKey, relClassId, direction] = key.split("|");
  return { ownerKey, relClassId, direction: direction === "forward" ? "forward" : "backward" };
}
