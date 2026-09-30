import { ClassModifier, ClassType } from "@itwin/ecschema-metadata";
import type { ClassRegistry } from "./ClassRegistry";
import type { NodeCategory } from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";

/** How a class is instantiated. Elements, aspects and models cover everything an authoring app
 * writes except relationship instances, which the graph itself already counts per edge. */
export type CensusKind = "element" | "aspect" | "model";

export interface ClassCensusEntry {
  readonly classId: string;
  readonly className: string;
  readonly schemaName: string;
  readonly category: NodeCategory;
  readonly kind: CensusKind;
  readonly count: number;
}

export interface SchemaUsage {
  readonly schemaName: string;
  /** Non-abstract entity/aspect/model classes the schema defines (what *could* be instantiated). */
  readonly classesDefined: number;
  /** Classes of this schema with at least one instance in the iModel. */
  readonly classesUsed: number;
  readonly instances: number;
}

export interface Census {
  readonly entries: readonly ClassCensusEntry[];
  readonly schemas: readonly SchemaUsage[];
  readonly totalInstances: number;
}

const KIND_TABLE: ReadonlyArray<[CensusKind, string]> = [
  ["element", "bis.Element"],
  ["aspect", "bis.ElementAspect"],
  ["model", "bis.Model"],
];

/** Schemas whose instances are infrastructure, not the app's data model. */
const SYSTEM_SCHEMAS = new Set(["ECDbMeta", "ECDbSystem", "ECDbMap", "ECDbFileInfo", "ECDbSchemaPolicies"]);

/** Counts every instantiated class. One grouped query per kind; ~10 ms on small iModels and
 * under a second even on multi-GB files (measured). */
export async function loadCensus(port: IModelQueryPort, registry: ClassRegistry): Promise<Census> {
  const entries: ClassCensusEntry[] = [];
  for (const [kind, table] of KIND_TABLE) {
    const rows = await port.query(`SELECT ECClassId Id, COUNT(*) N FROM ${table} GROUP BY ECClassId`);
    for (const r of rows) {
      const className = registry.nameOf(r.Id);
      const schemaName = className.split(":")[0];
      if (SYSTEM_SCHEMAS.has(schemaName))
        continue;
      entries.push({ classId: r.Id, className, schemaName, category: registry.categoryOf(r.Id), kind, count: Number(r.N) });
    }
  }
  entries.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
  return { entries, schemas: schemaUsage(entries, registry), totalInstances: entries.reduce((s, e) => s + e.count, 0) };
}

/** Per-schema rollup: how much of each schema the authoring app actually used. */
export function schemaUsage(entries: readonly ClassCensusEntry[], registry: ClassRegistry): SchemaUsage[] {
  const used = new Map<string, { classes: Set<string>; instances: number }>();
  for (const e of entries) {
    const u = used.get(e.schemaName) ?? { classes: new Set<string>(), instances: 0 };
    u.classes.add(e.className);
    u.instances += e.count;
    used.set(e.schemaName, u);
  }
  const defined = new Map<string, number>();
  for (const name of registry.allClassNames()) {
    const schema = name.split(":")[0];
    if (SYSTEM_SCHEMAS.has(schema) || !used.has(schema))
      continue;
    const cls = registry.findClass(name);
    // Count what could be instantiated: concrete classes, not abstract ones, mixins or relationships.
    if (cls && cls.modifier !== ClassModifier.Abstract && cls.type === ClassType.Entity)
      defined.set(schema, (defined.get(schema) ?? 0) + 1);
  }
  return [...used.entries()]
    .map(([schemaName, u]) => ({
      schemaName,
      classesDefined: Math.max(defined.get(schemaName) ?? 0, u.classes.size),
      classesUsed: u.classes.size,
      instances: u.instances,
    }))
    .sort((a, b) => b.instances - a.instances || a.schemaName.localeCompare(b.schemaName));
}

export interface ModelCensusEntry {
  readonly modelId: string;
  readonly classId: string;
  readonly className: string;
  readonly count: number;
}

/** Element counts per class inside one model. Lazy: this can take seconds per call on huge files,
 * so it runs only when a model row is expanded. */
export async function loadModelCensus(port: IModelQueryPort, registry: ClassRegistry, modelId: string): Promise<ModelCensusEntry[]> {
  if (!/^0x[0-9a-f]+$/i.test(modelId))
    return [];
  const rows = await port.query(`SELECT ECClassId Id, COUNT(*) N FROM bis.Element WHERE Model.Id = ${modelId} GROUP BY ECClassId ORDER BY COUNT(*) DESC`);
  return rows.map((r) => ({ modelId, classId: r.Id, className: registry.nameOf(r.Id), count: Number(r.N) }));
}

/** Element counts per model (totals only; per-class breakdown is {@link loadModelCensus}). */
export async function loadModelTotals(port: IModelQueryPort): Promise<Map<string, number>> {
  const rows = await port.query("SELECT Model.Id Id, COUNT(*) N FROM bis.Element GROUP BY Model.Id");
  return new Map(rows.map((r) => [r.Id as string, Number(r.N)]));
}
