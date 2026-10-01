import { Id64 } from "@itwin/core-bentley";
import type { GraphEngine } from "./GraphEngine";
import { runSeedQuery, type SeedQueryResult } from "./seedQuery";

export const INSTANCE_SEARCH_LIMIT = 50;

function literal(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** ECSQL finding elements whose user label or code contains `text` (case-insensitive, wildcards
 * matched literally), or whose id is exactly `text`. Undefined when the text is too short. */
export function buildInstanceSearchQuery(text: string, limit = INSTANCE_SEARCH_LIMIT): string | undefined {
  const t = text.trim();
  const id = t.toLowerCase();
  const isId = Id64.isValidId64(id) && Id64.isValid(id);
  if (t.length < 2 && !isId) return undefined;
  const pattern = literal(`%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const conditions = [`UserLabel LIKE ${pattern} ESCAPE '\\'`, `CodeValue LIKE ${pattern} ESCAPE '\\'`];
  if (isId) conditions.unshift(`ECInstanceId = ${id}`);
  return `SELECT ECInstanceId, ECClassId FROM bis.Element WHERE ${conditions.join(" OR ")} LIMIT ${Math.max(1, Math.floor(limit))}`;
}

export async function searchInstances(engine: GraphEngine, text: string, limit = INSTANCE_SEARCH_LIMIT): Promise<SeedQueryResult["candidates"]> {
  const ecsql = buildInstanceSearchQuery(text, limit);
  return ecsql ? (await runSeedQuery(engine, ecsql)).candidates : [];
}
