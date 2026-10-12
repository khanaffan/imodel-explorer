import {
  formatPath, type NativeNode, printBoolean, printClassRef, printComputed, printValue, quoteIdentifier,
} from "./ecsqlParse";

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
export type CompoundOp = "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT";
export type JoinDirection = "FORWARD" | "BACKWARD";

/** `className` is `Schema:Class`. `raw` holds a FROM item the builder cannot model (subquery, table
 * valued function, unusual polymorphism) as editable ECSQL; `alias` is for display only. */
export type Source =
  | { kind: "class"; className: string; alias?: string; only?: boolean }
  | { kind: "cte"; name: string; alias?: string }
  | { kind: "raw"; ecsql: string; alias?: string };

export type Join =
  | { kind: "on"; type: JoinType; source: Source; on: Cond; relationship?: string }
  | { kind: "using"; source: Source; relationship: string; direction?: JoinDirection }
  | { kind: "cross"; source: Source };

export interface FromItem { source: Source; joins: Join[] }

export type PredOp =
  | "=" | "<>" | "<" | "<=" | ">" | ">="
  | "LIKE" | "NOT LIKE" | "IN" | "NOT IN" | "BETWEEN" | "NOT BETWEEN"
  | "IS NULL" | "IS NOT NULL" | "IS" | "IS NOT";

export type Cond =
  | { kind: "group"; op: "AND" | "OR"; items: Cond[] }
  | { kind: "not"; item: Cond }
  | { kind: "pred"; left: string; op: PredOp; args: string[] }
  | { kind: "raw"; ecsql: string };

export interface Column { expr: string; alias?: string }
export interface OrderTerm { expr: string; dir?: "ASC" | "DESC" }

export interface SelectModel {
  quantifier?: "DISTINCT" | "ALL";
  columns: Column[];
  from: FromItem[];
  where?: Cond;
  groupBy: string[];
  having?: Cond;
  orderBy: OrderTerm[];
  limit?: string;
  offset?: string;
  options?: string;
}

export interface SelectChain { first: SelectModel; rest: Array<{ op: CompoundOp; select: SelectModel }> }
export interface CteModel { name: string; columns: string[]; query: SelectChain }
export interface QueryDoc { recursive: boolean; ctes: CteModel[]; main: SelectChain }

/** How many value operands each operator takes; `"n"` means one or more. */
export const PRED_ARITY: Record<PredOp, number | "n"> = {
  "=": 1, "<>": 1, "<": 1, "<=": 1, ">": 1, ">=": 1, "LIKE": 1, "NOT LIKE": 1,
  "IN": "n", "NOT IN": "n", "BETWEEN": 2, "NOT BETWEEN": 2, "IS NULL": 0, "IS NOT NULL": 0, "IS": "n", "IS NOT": "n",
};

const COMPARE_OPS = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);

// ---------------------------------------------------------------------------------------------
// Native parse tree → model

function asNode(value: unknown, what: string): NativeNode {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Unexpected parse tree: ${what} is missing.`);
  return value as NativeNode;
}

function asArray(value: unknown): NativeNode[] {
  return Array.isArray(value) ? value as NativeNode[] : [];
}

export function condFromNative(node: NativeNode): Cond {
  if (node.id === "BooleanFactorExp" && node.op === "NOT")
    return { kind: "not", item: condFromNative(asNode(node.exp, "NOT operand")) };
  if (node.id !== "BinaryBooleanExp")
    return { kind: "raw", ecsql: printComputed(node) };
  const op = String(node.op);
  if (op === "AND" || op === "OR") {
    const items: Cond[] = [];
    for (const side of [node.lhs, node.rhs]) {
      const c = condFromNative(asNode(side, op));
      if (c.kind === "group" && c.op === op) items.push(...c.items);
      else items.push(c);
    }
    return { kind: "group", op, items };
  }
  const left = (): string => printComputed(asNode(node.lhs, "left operand"));
  const rhs = node.rhs as unknown;
  if (COMPARE_OPS.has(op))
    return { kind: "pred", left: left(), op: op === "!=" ? "<>" : op as PredOp, args: [printComputed(asNode(rhs, "right operand"))] };
  if (op === "IS" || op === "IS NOT") {
    if (Array.isArray(rhs))
      return { kind: "pred", left: left(), op, args: (rhs as NativeNode[]).map(printClassRef) };
    const r = rhs as NativeNode;
    if (r.id === "LiteralValueExp" && r.kind === "NULL")
      return { kind: "pred", left: left(), op: op === "IS" ? "IS NULL" : "IS NOT NULL", args: [] };
  }
  if ((op === "LIKE" || op === "NOT LIKE") && !(rhs as NativeNode).escape)
    return { kind: "pred", left: left(), op, args: [printValue(asNode((rhs as NativeNode).pattren, "LIKE pattern"))] };
  if ((op === "IN" || op === "NOT IN") && Array.isArray(rhs))
    return { kind: "pred", left: left(), op, args: (rhs as NativeNode[]).map(printValue) };
  if (op === "BETWEEN" || op === "NOT BETWEEN") {
    const r = asNode(rhs, "BETWEEN bounds");
    return { kind: "pred", left: left(), op, args: [printValue(asNode(r.lbound, "lower bound")), printValue(asNode(r.ubound, "upper bound"))] };
  }
  return { kind: "raw", ecsql: printBoolean(node) };
}

function sourceFromNative(node: NativeNode): Source {
  const alias = typeof node.alias === "string" && node.alias ? node.alias : undefined;
  if (node.id === "ClassNameExp") {
    const poly = node.polymorphicInfo as NativeNode | undefined;
    const simplePoly = !poly || (poly.scope === "ONLY" && !poly.disqualify);
    if (!node.tableSpace && !node.func && simplePoly)
      return { kind: "class", className: `${String(node.schemaName)}:${String(node.className)}`, alias, ...(poly ? { only: true } : {}) };
  } else if (node.id === "CommonTableBlockNameExp") {
    return { kind: "cte", name: String(node.name), alias };
  }
  return { kind: "raw", ecsql: printClassRef(node), alias };
}

const JOIN_TYPES: Record<string, JoinType> = {
  "INNER JOIN": "INNER", "LEFT OUTER JOIN": "LEFT", "RIGHT OUTER JOIN": "RIGHT", "FULL OUTER JOIN": "FULL",
};

function isJoinNode(node: NativeNode): boolean {
  return node.id === "QualifiedJoinExp" || node.id === "UsingRelationshipJoinExp" || node.id === "CrossJoinExp";
}

/** Flattens a left-deep join tree. Anything else (a join nested on the right) becomes one raw item. */
function fromItemFromNative(node: NativeNode): FromItem {
  if (!isJoinNode(node))
    return { source: sourceFromNative(node), joins: [] };
  const to = asNode(node.to, "join target");
  const fallback = (): FromItem => ({ source: { kind: "raw", ecsql: printClassRef(node) }, joins: [] });
  if (isJoinNode(to))
    return fallback();
  let join: Join;
  if (node.id === "CrossJoinExp") {
    join = { kind: "cross", source: sourceFromNative(to) };
  } else if (node.id === "UsingRelationshipJoinExp") {
    const rel = asNode(node.using, "USING relationship");
    const direction = node.direction === "FORWARD" || node.direction === "BACKWARD" ? node.direction : undefined;
    join = { kind: "using", source: sourceFromNative(to), relationship: `${String(rel.schemaName)}:${String(rel.className)}`, ...(direction ? { direction } : {}) };
  } else {
    const type = JOIN_TYPES[String(node.type)];
    if (!type || !node.spec || Array.isArray(node.spec))
      return fallback();
    join = { kind: "on", type, source: sourceFromNative(to), on: condFromNative(asNode(node.spec, "ON condition")) };
  }
  const left = fromItemFromNative(asNode(node.from, "join source"));
  return { source: left.source, joins: [...left.joins, join] };
}

function selectFromNative(node: NativeNode): SelectModel {
  if (node.id !== "SingleSelectStatementExp")
    throw new Error(`Unsupported select block '${String(node.id)}'.`);
  const options = node.options ? asArray((node.options as NativeNode).options)
    .map((o) => `${String(o.name)}${o.value !== undefined ? `=${String(o.value)}` : ""}`).join(" ") : undefined;
  const limit = node.limit as NativeNode | undefined;
  const quantifier = node.selectionType === "DISTINCT" || node.selectionType === "ALL" ? node.selectionType : undefined;
  return {
    ...(quantifier ? { quantifier } : {}),
    columns: asArray(node.selection).map((d) => ({
      expr: printComputed(asNode(d.exp, "selected expression")),
      ...(typeof d.alias === "string" && d.alias ? { alias: d.alias } : {}),
    })),
    from: asArray(node.from).map(fromItemFromNative),
    ...(node.where ? { where: condFromNative(asNode(node.where, "WHERE")) } : {}),
    groupBy: asArray(node.groupBy).map(printValue),
    ...(node.having ? { having: condFromNative(asNode(node.having, "HAVING")) } : {}),
    orderBy: asArray(node.orderBy).map((o) => ({
      expr: printValue(asNode(o.exp, "ORDER BY term")),
      ...(o.direction === "ASC" || o.direction === "DESC" ? { dir: o.direction } : {}),
    })),
    ...(limit ? { limit: printValue(asNode(limit.exp, "LIMIT")) } : {}),
    ...(limit?.offset ? { offset: printValue(asNode(limit.offset, "OFFSET")) } : {}),
    ...(options ? { options } : {}),
  };
}

function chainFromNative(node: NativeNode): SelectChain {
  if (node.id !== "SelectStatementExp")
    throw new Error(`Unsupported statement '${String(node.id)}'.`);
  const chain: SelectChain = { first: selectFromNative(asNode(node.select, "SELECT")), rest: [] };
  let next = node.nextBlock as NativeNode | undefined;
  while (next) {
    const stmt = asNode(next.select, "compound SELECT");
    chain.rest.push({ op: String(next.combineOp) as CompoundOp, select: selectFromNative(asNode(stmt.select, "SELECT")) });
    next = stmt.nextBlock as NativeNode | undefined;
  }
  return chain;
}

/** Builds the editable model from a native SELECT parse tree. Throws when a part cannot even be
 * printed back as ECSQL; callers then fall back to text-only editing. */
export function docFromNative(tree: NativeNode): QueryDoc {
  if (tree.id === "CommonTableExp") {
    return {
      recursive: tree.recursive === true,
      ctes: asArray(tree.blocks).map((b) => ({
        name: String(b.name),
        columns: Array.isArray(b.args) ? b.args.map(String) : [],
        query: chainFromNative(asNode(b.asQuery, "CTE query")),
      })),
      main: chainFromNative(asNode(tree.select, "CTE body")),
    };
  }
  return { recursive: false, ctes: [], main: chainFromNative(tree) };
}

// ---------------------------------------------------------------------------------------------
// Model → ECSQL

export function predComplete(c: Extract<Cond, { kind: "pred" }>): boolean {
  const arity = PRED_ARITY[c.op];
  const args = c.args.filter((a) => a.trim());
  return c.left.trim() !== "" && (arity === "n" ? args.length > 0 : args.length === arity);
}

/** Removes incomplete predicates and empty groups; they are editing states, not query text. */
export function pruneCond(c: Cond | undefined): Cond | undefined {
  if (!c) return undefined;
  switch (c.kind) {
    case "raw": return c.ecsql.trim() ? c : undefined;
    case "pred": return predComplete(c) ? c : undefined;
    case "not": {
      const item = pruneCond(c.item);
      return item ? { kind: "not", item } : undefined;
    }
    case "group": {
      const items = c.items.map(pruneCond).filter((i): i is Cond => !!i);
      if (items.length === 0) return undefined;
      return items.length === 1 ? items[0] : { ...c, items };
    }
  }
}

function printPred(c: Extract<Cond, { kind: "pred" }>): string {
  const args = c.args.filter((a) => a.trim());
  switch (c.op) {
    case "IS NULL": case "IS NOT NULL": return `${c.left} ${c.op}`;
    case "IN": case "NOT IN": case "IS": case "IS NOT": return `${c.left} ${c.op} (${args.join(", ")})`;
    case "BETWEEN": case "NOT BETWEEN": return `${c.left} ${c.op} ${args[0]} AND ${args[1]}`;
    default: return `${c.left} ${c.op} ${args[0]}`;
  }
}

/** Prints a pruned condition. Nested groups and raw chips are parenthesised. */
export function printCond(c: Cond, nested = false): string {
  switch (c.kind) {
    case "raw": return nested ? `(${c.ecsql})` : c.ecsql;
    case "pred": return printPred(c);
    case "not": return `NOT (${printCond(c.item)})`;
    case "group": {
      const text = c.items.map((i) => printCond(i, true)).join(` ${c.op} `);
      return nested && c.items.length > 1 ? `(${text})` : text;
    }
  }
}

export function printClassName(className: string): string {
  return className.split(/[:.]/).map(quoteIdentifier).join(".");
}

export function printSource(s: Source): string {
  const alias = s.alias ? ` ${quoteIdentifier(s.alias)}` : "";
  switch (s.kind) {
    case "class": return `${s.only ? "ONLY " : ""}${printClassName(s.className)}${alias}`;
    case "cte": return `${quoteIdentifier(s.name)}${alias}`;
    case "raw": return s.ecsql;
  }
}

function printJoin(j: Join, indent: string): string {
  switch (j.kind) {
    case "cross": return `${indent}CROSS JOIN ${printSource(j.source)}`;
    case "using": return `${indent}JOIN ${printSource(j.source)} USING ${printClassName(j.relationship)}${j.direction ? ` ${j.direction}` : ""}`;
    case "on": {
      const on = pruneCond(j.on);
      const type = j.type === "INNER" ? "JOIN" : `${j.type} JOIN`;
      return `${indent}${type} ${printSource(j.source)} ON ${on ? printCond(on) : "1 = 1"}`;
    }
  }
}

export function printSelect(s: SelectModel, indent = ""): string {
  const lines: string[] = [];
  const cols = s.columns.length === 0 ? "*" : s.columns.map((c) => `${c.expr}${c.alias ? ` ${quoteIdentifier(c.alias)}` : ""}`).join(", ");
  lines.push(`SELECT ${s.quantifier ? `${s.quantifier} ` : ""}${cols}`);
  if (s.from.length > 0) {
    lines.push(`FROM ${s.from.map((f, i) => [
      `${i > 0 ? `${indent}  ` : ""}${printSource(f.source)}`,
      ...f.joins.map((j) => printJoin(j, `${indent}  `)),
    ].join("\n")).join(",\n")}`);
  }
  const where = pruneCond(s.where);
  if (where) lines.push(`WHERE ${printCond(where)}`);
  if (s.groupBy.length > 0) lines.push(`GROUP BY ${s.groupBy.join(", ")}`);
  const having = pruneCond(s.having);
  if (having) lines.push(`HAVING ${printCond(having)}`);
  if (s.orderBy.length > 0) lines.push(`ORDER BY ${s.orderBy.map((o) => `${o.expr}${o.dir ? ` ${o.dir}` : ""}`).join(", ")}`);
  if (s.limit?.trim()) lines.push(`LIMIT ${s.limit}${s.offset?.trim() ? ` OFFSET ${s.offset}` : ""}`);
  if (s.options?.trim()) lines.push(`ECSQLOPTIONS ${s.options}`);
  return lines.join(`\n${indent}`);
}

export function printChain(c: SelectChain, indent = ""): string {
  return [printSelect(c.first, indent), ...c.rest.map((r) => `${r.op}\n${indent}${printSelect(r.select, indent)}`)].join(`\n${indent}`);
}

export function printDoc(doc: QueryDoc): string {
  if (doc.ctes.length === 0)
    return printChain(doc.main);
  const blocks = doc.ctes.map((c) =>
    `${quoteIdentifier(c.name)}${c.columns.length > 0 ? `(${c.columns.map(quoteIdentifier).join(", ")})` : ""} AS (\n  ${printChain(c.query, "  ")}\n)`);
  return `WITH ${doc.recursive ? "RECURSIVE " : ""}${blocks.join(",\n")}\n${printChain(doc.main)}`;
}

// ---------------------------------------------------------------------------------------------
// Editing helpers

/** The name property references use for a source: its alias, else the CTE or class name. */
export function sourceRef(s: Source): string | undefined {
  if (s.alias) return s.alias;
  if (s.kind === "cte") return s.name;
  return undefined;
}

export function allSources(s: SelectModel): Source[] {
  return s.from.flatMap((f) => [f.source, ...f.joins.map((j) => j.source)]);
}

export function usedAliases(s: SelectModel): Set<string> {
  const used = new Set<string>();
  for (const src of allSources(s)) {
    const ref = sourceRef(src);
    if (ref) used.add(ref.toLowerCase());
  }
  return used;
}

/** Short alias from the class name's capitals (`PhysicalElement` → `pe`), made unique. */
export function makeAlias(name: string, used: ReadonlySet<string>): string {
  const local = name.split(/[:.]/).pop() ?? name;
  const caps = local.match(/[A-Z]/g)?.join("").toLowerCase();
  const base = (caps && caps.length <= 4 ? caps : local.slice(0, 1).toLowerCase()) || "t";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    if (!used.has(candidate) && quoteIdentifier(candidate) === candidate)
      return candidate;
  }
}

function isIdentChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

/** Applies `fn` to each identifier token outside string literals and quoted identifiers. `fn`
 * receives the identifier, its start offset and the full text, and returns the replacement. */
function mapIdentifiers(sql: string, fn: (ident: string, start: number, end: number) => string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === "\"") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === ch && sql[j + 1] !== ch)) j += sql[j] === ch ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "[" || /[A-Za-z_]/.test(ch)) {
      let j = i;
      let ident: string;
      if (ch === "[") {
        j = sql.indexOf("]", i + 1);
        if (j < 0) { out += sql.slice(i); break; }
        ident = sql.slice(i + 1, j);
        j++;
      } else {
        while (isIdentChar(sql[j])) j++;
        ident = sql.slice(i, j);
      }
      out += fn(ident, i, j);
      i = j;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (isIdentChar(sql[j])) j++;
      out += sql.slice(i, j);
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Renames the qualifier `from.` to `to.` in an expression (`e.Model.Id` → `x.Model.Id`). */
export function renameQualifier(sql: string, from: string, to: string): string {
  return mapIdentifiers(sql, (ident, start, end) =>
    ident.toLowerCase() === from.toLowerCase() && sql[end] === "." && sql[start - 1] !== "." ? quoteIdentifier(to) : sql.slice(start, end));
}

/** Prefixes unqualified references to `properties` with `qualifier.`. Function names (followed by
 * `(`) and member accesses (preceded by `.`) are left alone. */
export function qualifyBare(sql: string, properties: ReadonlySet<string>, qualifier: string): string {
  return mapIdentifiers(sql, (ident, start, end) => {
    const original = sql.slice(start, end);
    if (!properties.has(ident.toLowerCase()) || sql[start - 1] === "." || sql[start - 1] === ":" || /^\s*\(/.test(sql.slice(end)))
      return original;
    return `${quoteIdentifier(qualifier)}.${original}`;
  });
}

/** True when the expression references `qualifier.` (case-insensitive). */
export function referencesQualifier(sql: string, qualifier: string): boolean {
  let found = false;
  mapIdentifiers(sql, (ident, start, end) => {
    if (ident.toLowerCase() === qualifier.toLowerCase() && sql[end] === "." && sql[start - 1] !== ".") found = true;
    return "";
  });
  return found;
}

function mapCond(c: Cond | undefined, fn: (sql: string) => string): Cond | undefined {
  if (!c) return undefined;
  switch (c.kind) {
    case "raw": return c;
    case "pred": return { ...c, left: fn(c.left), args: c.args.map(fn) };
    case "not": return { kind: "not", item: mapCond(c.item, fn)! };
    case "group": return { ...c, items: c.items.map((i) => mapCond(i, fn)!) };
  }
}

/** Applies `fn` to every structured expression of a select (raw chips are left untouched). */
export function mapExpressions(s: SelectModel, fn: (sql: string) => string): SelectModel {
  return {
    ...s,
    columns: s.columns.map((c) => ({ ...c, expr: fn(c.expr) })),
    from: s.from.map((f) => ({ ...f, joins: f.joins.map((j) => j.kind === "on" ? { ...j, on: mapCond(j.on, fn)! } : j) })),
    where: mapCond(s.where, fn),
    groupBy: s.groupBy.map(fn),
    having: mapCond(s.having, fn),
    orderBy: s.orderBy.map((o) => ({ ...o, expr: fn(o.expr) })),
  };
}

function mapSources(s: SelectModel, fn: (src: Source) => Source): SelectModel {
  return { ...s, from: s.from.map((f) => ({ source: fn(f.source), joins: f.joins.map((j) => ({ ...j, source: fn(j.source) })) })) };
}

/** Renames a source alias and every structured reference to it. */
export function renameAlias(s: SelectModel, from: string, to: string): SelectModel {
  const renamed = mapSources(s, (src) => src.alias?.toLowerCase() === from.toLowerCase() ? { ...src, alias: to } : src);
  return mapExpressions(renamed, (sql) => renameQualifier(sql, from, to));
}

/** Gives `item`'s source an alias when it has none, qualifying the existing unqualified references
 * to its properties (needed before joining, when names like ECInstanceId become ambiguous). */
export function ensureAlias(s: SelectModel, index: number, properties: ReadonlySet<string>): { select: SelectModel; alias: string } {
  const src = s.from[index]?.source;
  if (!src) throw new Error(`No FROM item ${index}.`);
  const existing = sourceRef(src);
  if (existing) return { select: s, alias: existing };
  const alias = makeAlias(src.kind === "class" ? src.className : "t", usedAliases(s));
  const withAlias: SelectModel = { ...s, from: s.from.map((f, i) => i === index ? { ...f, source: { ...f.source, alias } } : f) };
  const single = allSources(s).length === 1;
  return { select: single ? mapExpressions(withAlias, (sql) => qualifyBare(sql, properties, alias)) : withAlias, alias };
}

/** Drops columns/order/group terms and predicates that reference any of `refs`. */
function dropReferences(s: SelectModel, refs: readonly string[]): SelectModel {
  const hit = (sql: string) => refs.some((r) => referencesQualifier(sql, r));
  const dropFrom = (c: Cond | undefined): Cond | undefined => {
    if (!c) return undefined;
    switch (c.kind) {
      case "raw": return c;
      case "pred": return hit(c.left) || c.args.some(hit) ? undefined : c;
      case "not": { const item = dropFrom(c.item); return item ? { kind: "not", item } : undefined; }
      case "group": { const items = c.items.map(dropFrom).filter((i): i is Cond => !!i); return items.length ? { ...c, items } : undefined; }
    }
  };
  return {
    ...s,
    columns: s.columns.filter((c) => !hit(c.expr)),
    where: dropFrom(s.where),
    groupBy: s.groupBy.filter((g) => !hit(g)),
    having: dropFrom(s.having),
    orderBy: s.orderBy.filter((o) => !hit(o.expr)),
  };
}

/** Removes a joined source and every structured column/order/group term referencing it. Conditions
 * are pruned of predicates mentioning it. */
export function removeJoin(s: SelectModel, itemIndex: number, joinIndex: number): SelectModel {
  const join = s.from[itemIndex]?.joins[joinIndex];
  if (!join) return s;
  const ref = sourceRef(join.source);
  const without = { ...s, from: s.from.map((f, i) => i === itemIndex ? { ...f, joins: f.joins.filter((_, j) => j !== joinIndex) } : f) };
  return ref ? dropReferences(without, [ref]) : without;
}

/** Removes a whole FROM item (with its joins) and every structured reference to its sources. */
export function removeFromItem(s: SelectModel, itemIndex: number): SelectModel {
  const item = s.from[itemIndex];
  if (!item) return s;
  const refs = [item.source, ...item.joins.map((j) => j.source)].map(sourceRef).filter((r): r is string => !!r);
  return dropReferences({ ...s, from: s.from.filter((_, i) => i !== itemIndex) }, refs);
}

export function propertyRef(qualifier: string | undefined, path: string): string {
  return qualifier ? `${quoteIdentifier(qualifier)}.${formatPath(path)}` : formatPath(path);
}

export function emptySelect(): SelectModel {
  return { columns: [], from: [], groupBy: [], orderBy: [] };
}

export function selectFromClass(className: string, alias?: string): SelectModel {
  const ref = alias;
  return {
    ...emptySelect(),
    columns: [{ expr: propertyRef(ref, "ECInstanceId") }, { expr: propertyRef(ref, "ECClassId") }],
    from: [{ source: { kind: "class", className, ...(alias ? { alias } : {}) }, joins: [] }],
  };
}
