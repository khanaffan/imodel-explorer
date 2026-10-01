import { Id64 } from "@itwin/core-bentley";
import { type DirectionFilter, type NodeKey, parseNodeKey } from "./GraphModel";

/** `Relations()` is experimental. Frontend ECSQL runs on the ConcurrentQuery worker pool, so a
 * connection-level PRAGMA is not a reliable guarantee: every statement that uses `Relations()`
 * carries this option itself. All such statements are built in this file (enforced by a test). */
export const EXPERIMENTAL_OPTION = "ECSQLOPTIONS ENABLE_EXPERIMENTAL_FEATURES";

/** Ids are inlined as hex literals, so they must be validated to keep the SQL injection-free. */
export function assertId(id: string): string {
  if (!Id64.isValidId64(id))
    throw new Error(`Invalid Id64: ${id}`);
  return id;
}

/** Quotes a `Schema:Class` or `Schema.Class` name as `[Schema].[Class]`. */
export function quoteClassName(fullName: string): string {
  const parts = fullName.split(/[:.]/);
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p)))
    throw new Error(`Invalid class name: ${fullName}`);
  return `[${parts[0]}].[${parts[1]}]`;
}

const RELATIONS_COLUMNS =
  "r.RelatedECInstanceId, r.RelatedECClassId, r.Direction, r.RelationshipECClassId, r.RelationshipECInstanceId, r.NavPropertyName";

/** One statement expanding every seed in the batch. Seeds are supplied as a UNION ALL subquery with
 * an index column, so rows map back to seeds without round-tripping 64-bit ids through numbers. */
export function instanceExclusionPredicate(classColumn: string, idColumn: string, excluded: readonly string[] = []): string {
  return excluded.length === 0 ? "" : `NOT (${excluded.map((key) => {
    const { classId, id } = parseNodeKey(key);
    return `(${classColumn} = ${assertId(classId)} AND ${idColumn} = ${assertId(id)})`;
  }).join(" OR ")})`;
}

export function buildRelationsQuery(seeds: readonly NodeKey[], direction: DirectionFilter, extra: { limit?: number; excludedInstances?: readonly string[] } = {}): string {
  const limit = extra.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(extra.limit))}` : "";
  const predicate = instanceExclusionPredicate("r.RelatedECClassId", "r.RelatedECInstanceId", extra.excludedInstances);
  return `SELECT s.i SeedIndex, ${RELATIONS_COLUMNS} FROM ${seedTable(seeds)}, ECVLib.Relations(s.id, s.cid, '${direction}') r${predicate ? ` WHERE ${predicate}` : ""}${limit} ${EXPERIMENTAL_OPTION}`;
}

export interface GroupRef {
  readonly seedIndex: number;
  readonly relClassId: string;
  readonly direction: "forward" | "backward";
}

/** A single scan that returns at most `fetchLimit` rows per (seed, relationship class, direction)
 * group, `maxRows` for the `unlimited` groups, plus any row whose related instance is in the id set
 * bound to parameter 1 when `withKnownIds`. Every row carries `N`, its group's total row count, so
 * hub fan-outs (a CodeSpec's 200k codes) cost one scan and a handful of transferred rows. */
export function buildRelationsCappedQuery(seeds: readonly NodeKey[], direction: DirectionFilter,
  caps: { fetchLimit: number; maxRows: number; unlimited: readonly GroupRef[]; withKnownIds: boolean; excludedInstances?: readonly string[] }): string {
  const int = (n: number) => Math.max(0, Math.floor(n));
  const group = "PARTITION BY s.i, r.RelationshipECClassId, r.Direction";
  const predicate = instanceExclusionPredicate("r.RelatedECClassId", "r.RelatedECInstanceId", caps.excludedInstances);
  const inner = `SELECT s.i SeedIndex, ${RELATIONS_COLUMNS}, ROW_NUMBER() OVER (${group}) Rn, COUNT(*) OVER (${group}) N FROM ${seedTable(seeds)}, ECVLib.Relations(s.id, s.cid, '${direction}') r${predicate ? ` WHERE ${predicate}` : ""}`;
  const keep = [`Rn <= ${int(caps.fetchLimit)}`];
  if (caps.unlimited.length > 0)
    keep.push(`(Rn <= ${int(caps.maxRows)} AND (${caps.unlimited.map(groupPredicate).join(" OR ")}))`);
  if (caps.withKnownIds)
    keep.push("InVirtualSet(?, RelatedECInstanceId)");
  return `SELECT * FROM (${inner}) WHERE ${keep.join(" OR ")} ${EXPERIMENTAL_OPTION}`;
}

function groupPredicate(g: GroupRef): string {
  if (!Number.isInteger(g.seedIndex) || g.seedIndex < 0)
    throw new Error(`Invalid seed index: ${g.seedIndex}`);
  return `(SeedIndex = ${g.seedIndex} AND RelationshipECClassId = ${assertId(g.relClassId)} AND Direction = '${g.direction === "forward" ? "forward" : "backward"}')`;
}

function seedTable(seeds: readonly NodeKey[]): string {
  if (seeds.length === 0)
    throw new Error("Relations() queries require at least one seed");
  const seedRows = seeds
    .map((s, i) => (i === 0 ? `SELECT ${i} i, ${assertId(s.id)} id, ${assertId(s.classId)} cid` : `SELECT ${i}, ${assertId(s.id)}, ${assertId(s.classId)}`))
    .join(" UNION ALL ");
  return `(${seedRows}) s`;
}

/** Cheapest statement that fails to prepare when `Relations()` is unsupported. */
export function buildRelationsProbeQuery(): string {
  return `SELECT r.RelatedECInstanceId FROM ECVLib.Relations(0x1, 0x1) r LIMIT 1 ${EXPERIMENTAL_OPTION}`;
}

/** A self-contained recursive traversal a developer can paste into any ECSQL tool. Mirrors what the
 * app does hop-by-hop. The option sits on the recursive term: it does not propagate into CTE bodies. */
export function buildTraversalRecipe(centre: NodeKey, depth: number, direction: DirectionFilter): string {
  const d = Math.max(0, Math.floor(depth));
  return [
    "WITH RECURSIVE reachable(Id, ClassId, Depth) AS (",
    `  SELECT ${assertId(centre.id)}, ${assertId(centre.classId)}, 0`,
    "  UNION",
    "  SELECT r.RelatedECInstanceId, r.RelatedECClassId, Depth + 1",
    `  FROM reachable, ECVLib.Relations(reachable.Id, reachable.ClassId, '${direction}') r`,
    `  WHERE Depth < ${d} ${EXPERIMENTAL_OPTION}`,
    ")",
    "SELECT Id, ec_classname(ClassId) ClassName, MIN(Depth) Depth FROM reachable GROUP BY Id, ClassId ORDER BY Depth, Id",
  ].join("\n");
}

export function buildClassCatalogQuery(): string {
  return "SELECT c.ECInstanceId Id, s.Name SchemaName, c.Name ClassName FROM meta.ECClassDef c JOIN meta.ECSchemaDef s ON s.ECInstanceId = c.Schema.Id";
}

/** Id-set lookups inline a validated `IN (...)` list: SQLite can seek the primary key with it,
 * whereas `InVirtualSet()` is a per-row function call that forces a full table scan (~0.7 s on a
 * 40 GB iModel versus ~0 ms). */
export function idList(ids: readonly string[]): string {
  if (ids.length === 0)
    throw new Error("Empty id list");
  return [...new Set(ids)].map(assertId).join(",");
}

/** Keeps generated statements a reasonable size. */
export const ID_LIST_CHUNK = 1000;

export function buildElementResolveQuery(ids: readonly string[]): string {
  return `SELECT ECInstanceId Id, ECClassId ClassId, CodeValue, UserLabel, Model.Id ModelId FROM bis.Element WHERE ECInstanceId IN (${idList(ids)})`;
}

export function buildModelResolveQuery(ids: readonly string[]): string {
  return `SELECT m.ECInstanceId Id, m.ECClassId ClassId, p.CodeValue, p.UserLabel FROM bis.Model m LEFT JOIN bis.Element p ON p.ECInstanceId = m.ModeledElement.Id WHERE m.ECInstanceId IN (${idList(ids)})`;
}

export function buildAspectResolveQuery(ids: readonly string[]): string {
  // bis.ElementAspect itself has no Element navigation property; only its two abstract bases do.
  const list = idList(ids);
  return `SELECT ECInstanceId Id, ECClassId ClassId, Element.Id ElementId FROM bis.ElementUniqueAspect WHERE ECInstanceId IN (${list})`
    + ` UNION ALL SELECT ECInstanceId Id, ECClassId ClassId, Element.Id ElementId FROM bis.ElementMultiAspect WHERE ECInstanceId IN (${list})`;
}

export function buildInstanceQuery(className: string): string {
  return `SELECT $ FROM ${quoteClassName(className)} WHERE ECInstanceId = ?`;
}

export function buildClassIdLookupQuery(className: string): string {
  return `SELECT ECClassId FROM ${quoteClassName(className)} WHERE ECInstanceId = ?`;
}
