import { QueryBinder } from "@itwin/core-common";
import type { ClassRegistry } from "./ClassRegistry";
import { buildClassIdLookupQuery, buildInstanceQuery } from "./ecsql";
import type { IModelQueryPort } from "./IModelQueryPort";

export interface NavTarget {
  readonly id: string;
  readonly relClassName: string;
  /** The constraint class at the far end; used to look up the target's actual ECClassId. */
  readonly targetBaseClass?: string;
}

export interface PropertyRecord {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly kind: "system" | "primitive" | "navigation" | "struct" | "array";
  readonly navTarget?: NavTarget;
  readonly children?: readonly PropertyRecord[];
}

const SYSTEM_PROPS = new Set(["ECInstanceId", "ECClassId", "SourceECInstanceId", "SourceECClassId", "TargetECInstanceId", "TargetECClassId"]);

function formatPrimitive(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Loads the full instance (`SELECT $`) and flattens it into readable records. Raw values are kept
 * on purpose: this is a developer tool, so what the database stores is what is shown. */
export async function loadInstanceProperties(port: IModelQueryPort, registry: ClassRegistry, className: string, id: string): Promise<PropertyRecord[]> {
  const rows = await port.query(buildInstanceQuery(className), new QueryBinder().bindId(1, id));
  if (rows.length === 0)
    return [];
  const instance = JSON.parse(rows[0].$) as Record<string, unknown>;
  const cls = registry.findClass(className);

  const toRecord = (name: string, value: unknown): PropertyRecord => {
    const prop = cls?.getProperty(name);
    const label = prop?.label || name;
    if (SYSTEM_PROPS.has(name)) {
      const shown = name.endsWith("ClassId") && typeof value === "string" ? `${registry.nameOf(value)} (${value})` : formatPrimitive(value);
      return { name, label, value: shown, kind: "system" };
    }
    if (prop?.isNavigation() && value && typeof value === "object" && "Id" in value) {
      const nav = value as { Id: string; RelECClassId?: string };
      const rel = prop.relationshipClass;
      const holderIsSource = prop.direction !== 2;
      const far = holderIsSource ? rel.target : rel.source;
      const relClassName = nav.RelECClassId ? registry.nameOf(nav.RelECClassId) : rel.fullName;
      return {
        name, label, value: nav.Id, kind: "navigation",
        navTarget: { id: nav.Id, relClassName, targetBaseClass: far?.abstractConstraint?.fullName ?? far?.constraintClasses[0]?.fullName },
      };
    }
    if (Array.isArray(value))
      return { name, label, value: `[${value.length}]`, kind: "array", children: value.map((v, i) => toRecord(`${name}[${i}]`, v)) };
    if (value && typeof value === "object")
      return { name, label, value: "{…}", kind: "struct", children: Object.entries(value).map(([k, v]) => toRecord(k, v)) };
    return { name, label, value: formatPrimitive(value), kind: "primitive" };
  };

  const records = Object.entries(instance).map(([k, v]) => toRecord(k, v));
  const order = { system: 0, primitive: 1, navigation: 2, struct: 3, array: 4 } as const;
  return records.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Resolves the concrete ECClassId of a navigation property target. */
export async function resolveNavTargetClassId(port: IModelQueryPort, target: NavTarget): Promise<string | undefined> {
  for (const candidate of [target.targetBaseClass, "BisCore:Element", "BisCore:Model"]) {
    if (!candidate) continue;
    try {
      const rows = await port.query(buildClassIdLookupQuery(candidate), new QueryBinder().bindId(1, target.id));
      if (rows[0]?.ECClassId) return rows[0].ECClassId;
    } catch { /* try the next candidate */ }
  }
  return undefined;
}

/** Resolves an id with no class (e.g. from a user query that only selected ECInstanceId). Elements
 * first, then models, then aspects; ambiguous partition/model ids resolve to the element. */
export async function resolveClassIdForId(port: IModelQueryPort, id: string): Promise<string | undefined> {
  for (const c of ["BisCore:Element", "BisCore:Model", "BisCore:ElementAspect"]) {
    const rows = await port.query(buildClassIdLookupQuery(c), new QueryBinder().bindId(1, id));
    if (rows[0]?.ECClassId) return rows[0].ECClassId as string;
  }
  return undefined;
}
