import { Id64 } from "@itwin/core-bentley";
import type { GraphEngine } from "./GraphEngine";
import { type NodeKey, nodeKeyString } from "./GraphModel";
import { resolveClassIdForId } from "./instanceProperties";
import type { Row } from "./IModelQueryPort";

export interface SeedCandidate {
  readonly key: NodeKey;
  readonly className: string;
  readonly label: string;
}

export interface SeedQueryResult {
  readonly candidates: SeedCandidate[];
  /** Rows skipped because no instance id could be found in them. */
  readonly skipped: number;
  readonly truncated: boolean;
}

export const SEED_LIMIT = 500;

const ID_COLUMNS = ["ecinstanceid", "id", "instanceid", "elementid"];
const CLASS_COLUMNS = ["ecclassid", "classid", "classname", "class"];

function column(row: Row, names: string[]): unknown {
  for (const [k, v] of Object.entries(row))
    if (names.includes(k.toLowerCase())) return v;
  return undefined;
}

function asId(v: unknown): string | undefined {
  if (typeof v === "string" && Id64.isValidId64(v)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return Id64.fromLocalAndBriefcaseIds(v, 0);
  return undefined;
}

/** Runs any user ECSQL and turns its rows into graph seeds. The id is taken from an
 * `ECInstanceId`/`Id` column (or the first id-looking value); the class from `ECClassId` or a
 * class-name column, else looked up. Labels come from the normal node resolver. */
export async function runSeedQuery(engine: GraphEngine, ecsql: string): Promise<SeedQueryResult> {
  const rows = await engine.port.query(ecsql, undefined, { limit: SEED_LIMIT + 1 });
  const truncated = rows.length > SEED_LIMIT;
  const keys: NodeKey[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of rows.slice(0, SEED_LIMIT)) {
    const id = asId(column(row, ID_COLUMNS)) ?? Object.values(row).map(asId).find((v) => v !== undefined);
    if (!id) { skipped++; continue; }
    const cls = column(row, CLASS_COLUMNS);
    let classId: string | undefined;
    if (typeof cls === "string")
      classId = Id64.isValidId64(cls) ? cls : engine.registry.idOf(cls);
    classId ??= await resolveClassIdForId(engine.port, id);
    if (!classId) { skipped++; continue; }
    const key = { id, classId };
    const ks = nodeKeyString(key);
    if (seen.has(ks)) continue;
    seen.add(ks);
    keys.push(key);
  }

  const resolved = await engine.resolver.resolve(keys);
  const candidates = keys.map((key) => {
    const n = resolved.get(nodeKeyString(key));
    return { key, className: n?.className ?? engine.registry.nameOf(key.classId), label: n?.label ?? key.id };
  });
  return { candidates, skipped, truncated };
}

export const EXAMPLE_SEED_QUERIES: ReadonlyArray<{ label: string; ecsql: string }> = [
  { label: "Physical elements", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.PhysicalElement" },
  { label: "By user label", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.Element WHERE UserLabel LIKE '%pump%'" },
  { label: "Element by id", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.Element WHERE ECInstanceId = 0x20000000001" },
  { label: "Models", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.Model" },
  { label: "Definition elements", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.DefinitionElement" },
  { label: "Root subject", ecsql: "SELECT ECInstanceId, ECClassId FROM bis.Subject WHERE Parent.Id IS NULL" },
];
