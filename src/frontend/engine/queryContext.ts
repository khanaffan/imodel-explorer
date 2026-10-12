import { Id64 } from "@itwin/core-bentley";
import { type SchemaView, SchemaViewPrimitiveType, StrengthDirection } from "@itwin/ecschema-metadata";
import type { ClassRegistry } from "./ClassRegistry";
import {
  type Cond, type CteModel, ensureAlias, type FromItem, type Join, type JoinDirection, type JoinType, makeAlias,
  type PredOp, printClassName, propertyRef, type SelectModel, type Source, sourceRef, usedAliases,
} from "./queryModel";

type ViewClass = SchemaView.Class;

// ---------------------------------------------------------------------------------------------
// Classes

export interface ClassChoice {
  readonly className: string;
  readonly label: string;
  readonly kind: "entity" | "mixin" | "relationship";
  readonly abstract: boolean;
  readonly count?: number;
}

/** Classes usable in FROM, most populated first. `counts` maps `Schema:Class` to instance counts. */
export function classChoices(registry: ClassRegistry, counts?: ReadonlyMap<string, number>): ClassChoice[] {
  const out: ClassChoice[] = [];
  for (const schema of registry.view.getSchemas())
    for (const cls of schema.getClasses()) {
      const kind = cls.isRelationship() ? "relationship" : cls.isMixin() ? "mixin" : cls.isEntity() ? "entity" : undefined;
      if (!kind) continue;
      const fullName = `${schema.name}:${cls.name}`;
      out.push({ className: fullName, label: cls.label || cls.name, kind, abstract: cls.isAbstract, count: counts?.get(fullName) });
    }
  return out.sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.className.localeCompare(b.className));
}

export function classLocalName(className: string): string {
  return className.split(/[:.]/).pop() ?? className;
}

// ---------------------------------------------------------------------------------------------
// Properties

export type FieldType = "string" | "number" | "boolean" | "dateTime" | "id" | "classId" | "enum" | "point" | "binary" | "struct" | "array" | "navigation" | "any";

export interface PropertyField {
  readonly path: string;
  readonly label: string;
  readonly type: FieldType;
  /** Usable as a scalar in WHERE/ORDER/GROUP. Structs, arrays, geometry and blobs are select-only. */
  readonly scalar: boolean;
  readonly enumValues?: ReadonlyArray<{ value: number | string; label: string }>;
  /** Sub-paths offered beneath this field (`Model.Id`, `Origin.X`). */
  readonly members?: readonly PropertyField[];
}

export interface PropertyGroup { readonly title: string; readonly fields: readonly PropertyField[] }

const SYSTEM_FIELDS: readonly PropertyField[] = [
  { path: "ECInstanceId", label: "ECInstanceId", type: "id", scalar: true },
  { path: "ECClassId", label: "ECClassId", type: "classId", scalar: true },
];

const RELATIONSHIP_FIELDS: readonly PropertyField[] = ["Source", "Target"].flatMap((end) => [
  { path: `${end}ECInstanceId`, label: `${end}ECInstanceId`, type: "id" as const, scalar: true },
  { path: `${end}ECClassId`, label: `${end}ECClassId`, type: "classId" as const, scalar: true },
]);

function primitiveField(name: string, prop: SchemaView.PrimitiveProperty): PropertyField {
  const enumeration = prop.enumeration;
  if (enumeration) {
    return {
      path: name, label: name, type: "enum", scalar: true,
      enumValues: [...enumeration.getEnumerators()].map((e) => ({ value: e.value, label: e.label || e.name })),
    };
  }
  switch (prop.primitiveType) {
    case SchemaViewPrimitiveType.String: return { path: name, label: name, type: "string", scalar: true };
    case SchemaViewPrimitiveType.Boolean: return { path: name, label: name, type: "boolean", scalar: true };
    case SchemaViewPrimitiveType.DateTime: return { path: name, label: name, type: "dateTime", scalar: true };
    case SchemaViewPrimitiveType.Double:
    case SchemaViewPrimitiveType.Integer: return { path: name, label: name, type: "number", scalar: true };
    case SchemaViewPrimitiveType.Long:
      return { path: name, label: name, type: prop.extendedTypeName === "Id" ? "id" : "number", scalar: true };
    case SchemaViewPrimitiveType.Point2d:
    case SchemaViewPrimitiveType.Point3d: {
      const axes = prop.primitiveType === SchemaViewPrimitiveType.Point3d ? ["X", "Y", "Z"] : ["X", "Y"];
      return {
        path: name, label: name, type: "point", scalar: false,
        members: axes.map((a) => ({ path: `${name}.${a}`, label: `${name}.${a}`, type: "number" as const, scalar: true })),
      };
    }
    default: return { path: name, label: name, type: "binary", scalar: false };
  }
}

export function propertyField(prop: SchemaView.Property): PropertyField {
  const name = prop.name;
  if (prop.isNavigation()) {
    return {
      path: name, label: name, type: "navigation", scalar: false,
      members: [
        { path: `${name}.Id`, label: `${name}.Id`, type: "id", scalar: true },
        { path: `${name}.RelECClassId`, label: `${name}.RelECClassId`, type: "classId", scalar: true },
      ],
    };
  }
  if (prop.isArray()) return { path: name, label: name, type: "array", scalar: false };
  if (prop.isStruct()) return { path: name, label: name, type: "struct", scalar: false };
  return primitiveField(name, prop as SchemaView.PrimitiveProperty);
}

/** System properties, then the class's own properties, then inherited ones grouped by the class
 * that declares them (nearest base first). */
export function propertyGroups(registry: ClassRegistry, className: string): PropertyGroup[] {
  const cls = registry.findClass(className);
  if (!cls) return [{ title: "System", fields: SYSTEM_FIELDS }];
  const groups: PropertyGroup[] = [{ title: "System", fields: cls.isRelationship() ? [...SYSTEM_FIELDS, ...RELATIONSHIP_FIELDS] : SYSTEM_FIELDS }];
  const byDeclaring = new Map<string, PropertyField[]>();
  for (const prop of cls.getProperties()) {
    const owner = prop.declaringClass?.fullName ?? cls.fullName;
    let list = byDeclaring.get(owner);
    if (!list) byDeclaring.set(owner, list = []);
    list.push(propertyField(prop));
  }
  const order = hierarchyNames(cls);
  const owners = [...byDeclaring.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const owner of owners)
    groups.push({ title: owner === cls.fullName ? `${cls.name} (own)` : `From ${owner.replace(".", ":")}`, fields: byDeclaring.get(owner)! });
  return groups;
}

function hierarchyNames(cls: ViewClass): string[] {
  const out = [cls.fullName];
  const queue = [cls];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const next of [c.baseClass, ...c.mixins])
      if (next && !out.includes(next.fullName)) { out.push(next.fullName); queue.push(next); }
  }
  return out;
}

/** Lower-cased names of every property path root of a class (for qualifying bare references). */
export function propertyNameSet(registry: ClassRegistry, className: string): Set<string> {
  return new Set(propertyGroups(registry, className).flatMap((g) => g.fields.map((f) => f.path.toLowerCase())));
}

/** Columns a CTE exposes: its declared column list, else the names of its first SELECT's columns. */
export function cteColumns(cte: CteModel): string[] {
  if (cte.columns.length > 0) return cte.columns;
  return cte.query.first.columns.map((c) => c.alias ?? c.expr.split(".").pop()!.replace(/^\[|\]$/g, ""));
}

/** Property fields for any source in a select. */
export function sourceFields(registry: ClassRegistry, source: Source, ctes: readonly CteModel[]): PropertyGroup[] {
  if (source.kind === "class") return propertyGroups(registry, source.className);
  if (source.kind === "cte") {
    const cte = ctes.find((c) => c.name.toLowerCase() === source.name.toLowerCase());
    return [{ title: "Columns", fields: (cte ? cteColumns(cte) : []).map((c) => ({ path: c, label: c, type: "any" as const, scalar: true })) }];
  }
  return [];
}

export function findField(groups: readonly PropertyGroup[], path: string): PropertyField | undefined {
  const lower = path.toLowerCase();
  for (const g of groups)
    for (const f of g.fields) {
      if (f.path.toLowerCase() === lower) return f;
      const m = f.members?.find((x) => x.path.toLowerCase() === lower);
      if (m) return m;
    }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Operators and literals

const OPS_BY_TYPE: Record<FieldType, readonly PredOp[]> = {
  string: ["=", "<>", "LIKE", "NOT LIKE", "IN", "NOT IN", "<", ">", "IS NULL", "IS NOT NULL"],
  number: ["=", "<>", "<", "<=", ">", ">=", "BETWEEN", "NOT BETWEEN", "IN", "NOT IN", "IS NULL", "IS NOT NULL"],
  dateTime: ["=", "<>", "<", "<=", ">", ">=", "BETWEEN", "NOT BETWEEN", "IS NULL", "IS NOT NULL"],
  boolean: ["=", "<>", "IS NULL", "IS NOT NULL"],
  id: ["=", "<>", "IN", "NOT IN", "IS NULL", "IS NOT NULL"],
  classId: ["IS", "IS NOT", "=", "<>", "IN", "NOT IN"],
  enum: ["=", "<>", "IN", "NOT IN", "IS NULL", "IS NOT NULL"],
  any: ["=", "<>", "<", "<=", ">", ">=", "LIKE", "NOT LIKE", "IN", "NOT IN", "BETWEEN", "NOT BETWEEN", "IS NULL", "IS NOT NULL"],
  point: ["IS NULL", "IS NOT NULL"],
  binary: ["IS NULL", "IS NOT NULL"],
  struct: [],
  array: [],
  navigation: ["IS NULL", "IS NOT NULL"],
};

export function operatorsFor(type: FieldType): readonly PredOp[] {
  return OPS_BY_TYPE[type];
}

export type LiteralResult = { ok: true; ecsql: string } | { ok: false; error: string };

const PARAMETER = /^(\?|:[A-Za-z_][A-Za-z0-9_]*)$/;

/** Formats user input as an ECSQL literal of the field's type. `?` and `:name` parameters pass
 * through. For `IS (…)` the operand is a class name. */
export function formatLiteral(type: FieldType, input: string, field?: PropertyField, op?: PredOp): LiteralResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter a value." };
  if (PARAMETER.test(text)) return { ok: true, ecsql: text };
  if (type === "classId" && (op === "IS" || op === "IS NOT")) {
    const m = /^(ONLY\s+)?([A-Za-z_]\w*)[:.]([A-Za-z_]\w*)$/i.exec(text);
    return m ? { ok: true, ecsql: `${m[1] ? "ONLY " : ""}${printClassName(`${m[2]}:${m[3]}`)}` } : { ok: false, error: "Enter a class as Schema:Class (optionally prefixed by ONLY)." };
  }
  switch (type) {
    case "string": return { ok: true, ecsql: `'${text.replace(/'/g, "''")}'` };
    case "number":
      return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text) ? { ok: true, ecsql: text } : { ok: false, error: `'${text}' is not a number.` };
    case "boolean":
      if (/^(true|1)$/i.test(text)) return { ok: true, ecsql: "TRUE" };
      if (/^(false|0)$/i.test(text)) return { ok: true, ecsql: "FALSE" };
      return { ok: false, error: "Enter true or false." };
    case "dateTime":
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: true, ecsql: `DATE '${text}'` };
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/.test(text)) return { ok: true, ecsql: `TIMESTAMP '${text.replace(" ", "T")}'` };
      return { ok: false, error: "Enter a date (YYYY-MM-DD) or timestamp (YYYY-MM-DDTHH:MM:SS)." };
    case "id":
    case "classId": {
      const hex = /^0x[0-9a-f]+$/i.test(text) ? text.toLowerCase() : /^\d+$/.test(text) ? `0x${BigInt(text).toString(16)}` : undefined;
      return hex && Id64.isValidId64(hex) ? { ok: true, ecsql: hex } : { ok: false, error: `'${text}' is not an id (hex 0x… or decimal).` };
    }
    case "enum": {
      const e = field?.enumValues?.find((v) => String(v.value) === text || v.label.toLowerCase() === text.toLowerCase());
      if (!e) return { ok: false, error: `Choose one of: ${field?.enumValues?.map((v) => `${v.label} (${v.value})`).join(", ") ?? "the enumerators"}.` };
      return { ok: true, ecsql: typeof e.value === "number" ? String(e.value) : `'${e.value.replace(/'/g, "''")}'` };
    }
    default:
      return { ok: true, ecsql: text };
  }
}

// ---------------------------------------------------------------------------------------------
// Relationships and joins

export type JoinForm = "navigation" | "linkTable" | "using";

export interface JoinSuggestion {
  readonly relationship: string;
  /** FORWARD when the anchor class is on the relationship's source end. */
  readonly direction: JoinDirection;
  readonly roleLabel: string;
  readonly otherClasses: readonly string[];
  readonly otherDefault: string;
  readonly otherMultiplicity: string;
  /** Navigation property backing the relationship, and which end declares it. */
  readonly navigation?: { readonly property: string; readonly holder: "anchor" | "other" };
  readonly abstract: boolean;
  readonly count?: number;
  readonly forms: readonly JoinForm[];
}

function multiplicity(c: SchemaView.RelConstraint): string {
  const up = c.multiplicityUpper <= 0 || c.multiplicityUpper >= 2147483647 ? "*" : String(c.multiplicityUpper);
  return `${c.multiplicityLower}..${up}`;
}

function accepts(c: SchemaView.RelConstraint, cls: ViewClass): boolean {
  return c.constraintClasses.some((k) => c.polymorphic ? cls.is(k) : k.fullName === cls.fullName);
}

function fullName(cls: ViewClass): string {
  return `${cls.schema.name}:${cls.name}`;
}

/** The navigation property that implements `rel`, looked up on the end that would hold it:
 * a FORWARD-direction navigation lives on the source end, BACKWARD on the target end. */
function findNavigation(rel: SchemaView.RelationshipClass): { property: string; end: "source" | "target" } | undefined {
  for (const end of ["source", "target"] as const) {
    const constraint = rel[end];
    if (!constraint) continue;
    for (const cls of constraint.constraintClasses)
      for (const prop of cls.getProperties())
        if (prop.isNavigation() && rel.is(prop.relationshipClass)) {
          const holderEnd = prop.direction === StrengthDirection.Forward ? "source" : "target";
          if (holderEnd === end) return { property: prop.name, end };
        }
  }
  return undefined;
}

const relationshipCache = new WeakMap<ClassRegistry, SchemaView.RelationshipClass[]>();

function relationshipClasses(registry: ClassRegistry): SchemaView.RelationshipClass[] {
  let list = relationshipCache.get(registry);
  if (!list) {
    list = [];
    for (const schema of registry.view.getSchemas())
      for (const cls of schema.getClasses())
        if (cls.isRelationship() && cls.source && cls.target) list.push(cls);
    relationshipCache.set(registry, list);
  }
  return list;
}

/** Relationships the anchor class can take part in (polymorphically), each with the end it would
 * reach and the recommended join forms. Populated relationships come first. */
export function joinSuggestions(registry: ClassRegistry, anchorClass: string, relCounts?: ReadonlyMap<string, number>): JoinSuggestion[] {
  const anchor = registry.findClass(anchorClass);
  if (!anchor) return [];
  const out: JoinSuggestion[] = [];
  for (const rel of relationshipClasses(registry)) {
    const nav = findNavigation(rel);
    const relName = fullName(rel);
    for (const [here, there, direction] of [["source", "target", "FORWARD"], ["target", "source", "BACKWARD"]] as const) {
      const mine = rel[here]!;
      const other = rel[there]!;
      if (!accepts(mine, anchor)) continue;
      const otherClasses = other.constraintClasses.map(fullName);
      const otherDefault = other.abstractConstraint ? fullName(other.abstractConstraint) : otherClasses[0];
      if (!otherDefault) continue;
      out.push({
        relationship: relName,
        direction,
        roleLabel: mine.roleLabel || (direction === "FORWARD" ? "→" : "←"),
        otherClasses,
        otherDefault,
        otherMultiplicity: multiplicity(other),
        ...(nav ? { navigation: { property: nav.property, holder: nav.end === here ? "anchor" : "other" } } : {}),
        abstract: rel.isAbstract,
        count: relCounts?.get(relName),
        forms: nav ? ["navigation", "linkTable", "using"] : ["linkTable", "using"],
      });
    }
  }
  return out.sort((a, b) => Number((b.count ?? 0) > 0) - Number((a.count ?? 0) > 0) || Number(a.abstract) - Number(b.abstract)
    || a.relationship.localeCompare(b.relationship) || a.direction.localeCompare(b.direction));
}

/** Suggestions from `anchorClass` whose other end can hold `otherClass`. */
export function connectingSuggestions(registry: ClassRegistry, anchorClass: string, otherClass: string, relCounts?: ReadonlyMap<string, number>): JoinSuggestion[] {
  const other = registry.findClass(otherClass);
  if (!other) return [];
  return joinSuggestions(registry, anchorClass, relCounts).filter((s) =>
    s.otherClasses.some((k) => { const c = registry.findClass(k); return !!c && (other.is(c) || c.is(other)); }));
}

/** Locates a source by the name references use (alias / CTE name). */
export function locateSource(s: SelectModel, ref: string): { item: number; join?: number } | undefined {
  const lower = ref.toLowerCase();
  for (let i = 0; i < s.from.length; i++) {
    if (sourceRef(s.from[i].source)?.toLowerCase() === lower) return { item: i };
    const j = s.from[i].joins.findIndex((x) => sourceRef(x.source)?.toLowerCase() === lower);
    if (j >= 0) return { item: i, join: j };
  }
  return undefined;
}

function sourceAt(s: SelectModel, at: { item: number; join?: number }): Source {
  return at.join === undefined ? s.from[at.item].source : s.from[at.item].joins[at.join].source;
}

export interface JoinRequest {
  /** Index of the FROM item and (optionally) join holding the anchor source. */
  readonly anchor: { item: number; join?: number };
  readonly suggestion: JoinSuggestion;
  readonly otherClass: string;
  readonly form: JoinForm;
  readonly type: JoinType;
}

/** Adds a relationship join to the select, giving the anchor an alias first if it has none. Returns
 * the new select and the alias of the class that was joined. */
export function applyJoin(registry: ClassRegistry, s: SelectModel, req: JoinRequest): { select: SelectModel; alias: string } {
  let select = s;
  let anchorRef: string;
  if (req.anchor.join === undefined) {
    const src = s.from[req.anchor.item].source;
    const props = src.kind === "class" ? propertyNameSet(registry, src.className) : new Set<string>();
    ({ select, alias: anchorRef } = ensureAlias(s, req.anchor.item, props));
  } else {
    const ref = sourceRef(sourceAt(s, req.anchor));
    if (!ref) throw new Error("The anchor source has no alias.");
    anchorRef = ref;
  }
  const used = usedAliases(select);
  const otherAlias = makeAlias(req.otherClass, used);
  used.add(otherAlias);
  const other: Source = { kind: "class", className: req.otherClass, alias: otherAlias };
  const a = (p: string) => propertyRef(anchorRef, p);
  const o = (p: string) => propertyRef(otherAlias, p);
  const sug = req.suggestion;
  const joins: Join[] = [];
  if (req.form === "using") {
    joins.push({ kind: "using", source: other, relationship: sug.relationship, direction: sug.direction });
  } else if (req.form === "navigation") {
    if (!sug.navigation) throw new Error(`${sug.relationship} is not backed by a navigation property.`);
    const on = sug.navigation.holder === "anchor"
      ? { kind: "pred" as const, left: o("ECInstanceId"), op: "=" as const, args: [a(`${sug.navigation.property}.Id`)] }
      : { kind: "pred" as const, left: o(`${sug.navigation.property}.Id`), op: "=" as const, args: [a("ECInstanceId")] };
    joins.push({ kind: "on", type: req.type, source: other, on, relationship: sug.relationship });
  } else {
    const relAlias = makeAlias(sug.relationship, used);
    const [mine, theirs] = sug.direction === "FORWARD" ? ["Source", "Target"] : ["Target", "Source"];
    const r = (p: string) => propertyRef(relAlias, p);
    joins.push({ kind: "on", type: req.type, source: { kind: "class", className: sug.relationship, alias: relAlias }, on: { kind: "pred", left: r(`${mine}ECInstanceId`), op: "=", args: [a("ECInstanceId")] }, relationship: sug.relationship });
    joins.push({ kind: "on", type: req.type, source: other, on: { kind: "pred", left: o("ECInstanceId"), op: "=", args: [r(`${theirs}ECInstanceId`)] }, relationship: sug.relationship });
  }
  const from: FromItem[] = select.from.map((f, i) => i === req.anchor.item ? { ...f, joins: [...f.joins, ...joins] } : f);
  return { select: { ...select, from }, alias: otherAlias };
}

/** Adds a class as a new FROM item (comma join) with a fresh alias. */
export function addSource(registry: ClassRegistry, s: SelectModel, className: string): { select: SelectModel; alias: string } {
  let select = s;
  if (s.from.length === 1 && s.from[0].joins.length === 0 && !sourceRef(s.from[0].source)) {
    const src = s.from[0].source;
    select = ensureAlias(s, 0, src.kind === "class" ? propertyNameSet(registry, src.className) : new Set()).select;
  }
  const alias = makeAlias(className, usedAliases(select));
  return { select: { ...select, from: [...select.from, { source: { kind: "class", className, alias }, joins: [] }] }, alias };
}

/** Every source with the name used to reference it and its display title. */
export function describeSources(s: SelectModel): Array<{ source: Source; ref?: string; title: string; at: { item: number; join?: number } }> {
  const out: Array<{ source: Source; ref?: string; title: string; at: { item: number; join?: number } }> = [];
  s.from.forEach((f, item) => {
    const add = (source: Source, join?: number) => out.push({
      source, ref: sourceRef(source), at: { item, ...(join !== undefined ? { join } : {}) },
      title: source.kind === "class" ? classLocalName(source.className) : source.kind === "cte" ? source.name : "Subquery",
    });
    add(f.source);
    f.joins.forEach((j, i) => add(j.source, i));
  });
  return out;
}


export function andCond(c: Cond | undefined, add: Cond): Cond {
  if (!c) return { kind: "group", op: "AND", items: [add] };
  if (c.kind === "group" && c.op === "AND") return { ...c, items: [...c.items, add] };
  return { kind: "group", op: "AND", items: [c, add] };
}

/** Relates two sources already in the query. Navigation relationships add `nav.Id = ECInstanceId` to
 * WHERE; link-table relationships join the relationship class to the anchor and constrain the other
 * source in WHERE. */
export function connectSources(s: SelectModel, anchorRef: string, otherRef: string, sug: JoinSuggestion): SelectModel {
  const a = (p: string) => propertyRef(anchorRef, p);
  const o = (p: string) => propertyRef(otherRef, p);
  if (sug.navigation) {
    const pred: Cond = sug.navigation.holder === "anchor"
      ? { kind: "pred", left: a(`${sug.navigation.property}.Id`), op: "=", args: [o("ECInstanceId")] }
      : { kind: "pred", left: o(`${sug.navigation.property}.Id`), op: "=", args: [a("ECInstanceId")] };
    return { ...s, where: andCond(s.where, pred) };
  }
  const at = locateSource(s, anchorRef);
  if (!at) throw new Error(`No source named ${anchorRef}.`);
  const relAlias = makeAlias(sug.relationship, usedAliases(s));
  const [mine, theirs] = sug.direction === "FORWARD" ? ["Source", "Target"] : ["Target", "Source"];
  const r = (p: string) => propertyRef(relAlias, p);
  const join: Join = { kind: "on", type: "INNER", source: { kind: "class", className: sug.relationship, alias: relAlias }, on: { kind: "pred", left: r(`${mine}ECInstanceId`), op: "=", args: [a("ECInstanceId")] }, relationship: sug.relationship };
  const from = s.from.map((f, i) => i === at.item ? { ...f, joins: [...f.joins, join] } : f);
  return { ...s, from, where: andCond(s.where, { kind: "pred", left: o("ECInstanceId"), op: "=", args: [r(`${theirs}ECInstanceId`)] }) };
}

/** The plain value a literal stands for, for editing in a typed value box; `undefined` when the
 * ECSQL is an expression (column reference, function…) that must be edited as text. */
export function literalDisplay(type: FieldType, ecsql: string, field?: PropertyField, op?: PredOp): string | undefined {
  const text = ecsql.trim();
  if (!text || PARAMETER.test(text)) return text;
  if (type === "classId" && (op === "IS" || op === "IS NOT"))
    return /^(ONLY\s+)?[A-Za-z_]\w*\.[A-Za-z_]\w*$/i.test(text) ? text.replace(".", ":") : undefined;
  switch (type) {
    case "string": { const m = /^'((?:[^']|'')*)'$/.exec(text); return m ? m[1].replace(/''/g, "'") : undefined; }
    case "number": return formatLiteral("number", text).ok ? text : undefined;
    case "boolean": return /^(TRUE|FALSE)$/i.test(text) ? text.toLowerCase() : undefined;
    case "dateTime": { const m = /^(DATE|TIMESTAMP)\s+'([^']*)'$/i.exec(text); return m ? m[2] : undefined; }
    case "id": case "classId": return /^0x[0-9a-f]+$/i.test(text) ? text : undefined;
    case "enum": return field?.enumValues?.find((v) => (typeof v.value === "number" ? String(v.value) : `'${v.value.replace(/'/g, "''")}'`) === text)?.label;
    default: return undefined;
  }
}
