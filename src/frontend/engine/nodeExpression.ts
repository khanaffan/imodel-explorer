import type { ClassRegistry } from "./ClassRegistry";
import type { GraphNode } from "./GraphModel";
import { SchemaViewPrimitiveType } from "@itwin/ecschema-metadata";
import { EXPRESSION_PROPERTY_PATTERN, expressionPropertySql } from "./ecsql";

export const NODE_FIELDS = ["label", "className", "schemaName", "category", "modelName", "id", "classId"] as const;
export type NodeField = typeof NODE_FIELDS[number];
export type Scalar = string | number | boolean | null;
export type Operand = { field: NodeField } | { prop: string } | { literal: Scalar };
export type NodeExpr =
  | { kind: "and" | "or"; args: NodeExpr[] }
  | { kind: "not"; arg: NodeExpr }
  | { kind: "compare"; op: "=" | "!=" | "<" | "<=" | ">" | ">="; left: Operand; right: Operand }
  | { kind: "like"; left: Operand; right: Operand }
  | { kind: "in"; left: Operand; values: Scalar[] }
  | { kind: "isNull" | "isNotNull"; operand: Operand };

function scalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function operand(value: unknown): Operand {
  if (!object(value) || Object.keys(value).length !== 1) throw new Error("Expected exactly one field, property or literal");
  if (typeof value.field === "string" && NODE_FIELDS.some((f) => f === value.field))
    return { field: NODE_FIELDS.find((f) => f === value.field)! };
  if (typeof value.prop === "string" && EXPRESSION_PROPERTY_PATTERN.test(value.prop)) return { prop: value.prop };
  if ("literal" in value && scalar(value.literal)) return { literal: value.literal };
  throw new Error("Invalid expression operand");
}

export function validateExpression(value: unknown): NodeExpr {
  let count = 0;
  const visit = (v: unknown, depth: number): NodeExpr => {
    if (++count > 500 || depth > 40) throw new Error("Expression is too complex");
    if (!object(v)) throw new Error("Invalid expression");
    switch (v.kind) {
      case "and": case "or":
        if (!Array.isArray(v.args) || v.args.length < 2) throw new Error("AND/OR requires at least two inputs");
        return { kind: v.kind, args: v.args.map((a: unknown) => visit(a, depth + 1)) };
      case "not": return { kind: "not", arg: visit(v.arg, depth + 1) };
      case "compare":
        if (v.op !== "=" && v.op !== "!=" && v.op !== "<" && v.op !== "<=" && v.op !== ">" && v.op !== ">=") throw new Error("Invalid comparison operator");
        return { kind: "compare", op: v.op, left: operand(v.left), right: operand(v.right) };
      case "like": return { kind: "like", left: operand(v.left), right: operand(v.right) };
      case "in":
        if (!Array.isArray(v.values) || !v.values.length || v.values.length > 100 || !v.values.every(scalar)) throw new Error("IN requires 1–100 literal values");
        return { kind: "in", left: operand(v.left), values: v.values };
      case "isNull": case "isNotNull": return { kind: v.kind, operand: operand(v.operand) };
      default: throw new Error("Invalid expression operator");
    }
  };
  return visit(value, 0);
}

interface Token { text: string; value?: Scalar; position: number }
export function parseExpression(text: string): NodeExpr {
  if (text.length > 16000) throw new Error("Expression is too long");
  const tokens: Token[] = [];
  const re = /\s+|'(?:[^']|'')*'|0x[0-9a-f]+|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_.]*|<=|>=|!=|<>|[=<>(),]/igy;
  let position = 0;
  while (position < text.length) {
    re.lastIndex = position;
    const match = re.exec(text);
    if (!match) throw new Error(`Unexpected character at position ${position + 1}`);
    const t = match[0];
    if (!/^\s/.test(t)) {
      const value = t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'")
        : /^0x/i.test(t) ? t.toLowerCase() : /^-?(?:\d|\.)/.test(t) ? Number(t)
          : /^true$/i.test(t) ? true : /^false$/i.test(t) ? false : /^null$/i.test(t) ? null : undefined;
      tokens.push({ text: t, value, position });
    }
    position = re.lastIndex;
  }
  let index = 0;
  let nesting = 0;
  const peek = (s: string) => tokens[index]?.text.toUpperCase() === s;
  const take = (s: string) => { if (!peek(s)) return false; index++; return true; };
  const error = (message: string): never => { throw new Error(`${message} at position ${(tokens[index]?.position ?? text.length) + 1}`); };
  const expect = (s: string) => { if (!take(s)) error(`Expected ${s}`); };
  const readOperand = (): Operand => {
    const t = tokens[index++];
    if (!t) return error("Expected a property or literal");
    if (t.value !== undefined) return { literal: t.value };
    if (t.text.startsWith("node.")) {
      const field = NODE_FIELDS.find((f) => f === t.text.slice(5));
      if (!field) return error(`Unknown node field ${t.text}`);
      return { field };
    }
    if (EXPRESSION_PROPERTY_PATTERN.test(t.text)) return { prop: t.text };
    return error("Expected a property or literal");
  };
  const unary = (): NodeExpr => {
    if (++nesting > 40) return error("Expression nesting exceeds 40");
    let result: NodeExpr;
    if (take("NOT")) result = { kind: "not", arg: unary() };
    else if (take("(")) { result = logic("OR"); expect(")"); }
    else {
      const left = readOperand();
      if (take("IS")) {
        const not = take("NOT"); expect("NULL");
        result = { kind: not ? "isNotNull" : "isNull", operand: left };
      } else {
        const not = take("NOT");
        if (take("LIKE")) result = { kind: "like", left, right: readOperand() };
        else if (take("IN")) {
          expect("(");
          const values: Scalar[] = [];
          do {
            const o = readOperand();
            if (!("literal" in o)) return error("IN accepts literals only");
            values.push(o.literal);
          } while (take(","));
          expect(")");
          result = { kind: "in", left, values };
        } else {
          if (not) return error("Expected LIKE or IN after NOT");
          const op = tokens[index++]?.text;
          if (op !== "=" && op !== "!=" && op !== "<>" && op !== "<" && op !== "<=" && op !== ">" && op !== ">=") return error("Expected a comparison");
          result = { kind: "compare", op: op === "<>" ? "!=" : op, left, right: readOperand() };
        }
        if (not) result = { kind: "not", arg: result };
      }
    }
    nesting--;
    return result;
  };
  const logic = (level: "AND" | "OR"): NodeExpr => {
    const next = () => level === "AND" ? unary() : logic("AND");
    const args = [next()];
    while (take(level)) args.push(next());
    return args.length === 1 ? args[0] : { kind: level === "AND" ? "and" : "or", args };
  };
  const expression = logic("OR");
  if (index !== tokens.length) error("Unexpected token");
  return validateExpression(expression);
}

function literalText(v: Scalar): string {
  return v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
}
function render(expr: NodeExpr, renderOperand: (o: Operand) => string): string {
  switch (expr.kind) {
    case "and": case "or": return `(${expr.args.map((a) => render(a, renderOperand)).join(` ${expr.kind.toUpperCase()} `)})`;
    case "not": return `NOT (${render(expr.arg, renderOperand)})`;
    case "compare": return `${renderOperand(expr.left)} ${expr.op} ${renderOperand(expr.right)}`;
    case "like": return `${renderOperand(expr.left)} LIKE ${renderOperand(expr.right)}`;
    case "in": return `${renderOperand(expr.left)} IN (${expr.values.map(literalText).join(", ")})`;
    case "isNull": case "isNotNull": return `${renderOperand(expr.operand)} IS ${expr.kind === "isNotNull" ? "NOT " : ""}NULL`;
  }
}
export function printExpression(expr: NodeExpr): string {
  return render(expr, (o) => "field" in o ? `node.${o.field}` : "prop" in o ? o.prop : literalText(o.literal));
}
export function expressionProperties(expr: NodeExpr): string[] {
  const names = new Set<string>();
  render(expr, (o) => { if ("prop" in o) names.add(o.prop); return ""; });
  return [...names];
}
function propertyCatalogue(registry: ClassRegistry) {
  const catalogue = new Map<string, { name: string; types: Set<string> }>();
  const add = (name: string, type: string) => {
    const key = name.toLowerCase();
    if (!catalogue.has(key)) catalogue.set(key, { name, types: new Set() });
    catalogue.get(key)!.types.add(type);
  };
  add("ECInstanceId", "string");
  add("ECClassId", "string");
  for (const n of registry.allClassNames()) {
    const cls = registry.findClass(n);
    if (!cls || (!cls.isEntity() && !cls.isRelationship())) continue;
    for (const p of cls.getProperties()) {
      if (p.isNavigation()) {
        add(`${p.name}.Id`, "string");
        add(`${p.name}.RelECClassId`, "string");
        continue;
      }
      if (!p.isPrimitive() || p.isArray()) continue;
      const type = p.primitiveType === SchemaViewPrimitiveType.String || p.primitiveType === SchemaViewPrimitiveType.DateTime ? "string"
        : p.primitiveType === SchemaViewPrimitiveType.Boolean ? "boolean"
          : [SchemaViewPrimitiveType.Integer, SchemaViewPrimitiveType.Long, SchemaViewPrimitiveType.Double].includes(p.primitiveType) ? "number" : undefined;
      if (!type) continue;
      add(p.name, type);
    }
  }
  return catalogue;
}

export function expressionPropertyNames(registry: ClassRegistry): string[] {
  return [...propertyCatalogue(registry).values()].map((p) => p.name).sort();
}

export function validateExpressionProperties(expr: NodeExpr, registry: ClassRegistry): void {
  const catalogue = propertyCatalogue(registry);
  for (const name of expressionProperties(expr))
    if (!catalogue.has(name.toLowerCase())) throw new Error(`Unknown or unsupported EC property: ${name}`);
  const operandTypes = (o: Operand): Set<string> => "field" in o ? new Set(["string"])
    : "prop" in o ? catalogue.get(o.prop.toLowerCase())!.types : new Set(o.literal === null ? [] : [typeof o.literal]);
  const compatible = (a: Operand, b: Operand, like = false) => {
    const at = operandTypes(a), bt = operandTypes(b);
    if (like ? [...at, ...bt].some((t) => t !== "string") : at.size && bt.size && ![...at].some((t) => bt.has(t)))
      throw new Error(like ? "LIKE requires string operands" : "Comparison operands have incompatible types");
  };
  const visit = (e: NodeExpr): void => {
    switch (e.kind) {
      case "and": case "or": e.args.forEach(visit); break;
      case "not": visit(e.arg); break;
      case "compare": compatible(e.left, e.right); break;
      case "like": compatible(e.left, e.right, true); break;
      case "in": e.values.forEach((v) => compatible(e.left, { literal: v })); break;
    }
  };
  visit(expr);
}

export function expressionPreview(expr: NodeExpr): string {
  const unsupported = new Set<string>();
  const where = render(expr, (o) => {
    if ("literal" in o) return literalText(o.literal);
    if ("prop" in o) return expressionPropertySql(o.prop);
    if (o.field === "id") return "ECInstanceId";
    if (o.field === "classId") return "ECClassId";
    if (o.field === "className") return "ec_classname(ECClassId)";
    unsupported.add(o.field);
    return `<node.${o.field}>`;
  });
  return `${unsupported.size ? `-- Not executable: node fields ${[...unsupported].join(", ")} require in-memory evaluation.\n` : ""}-- ECSQL illustration only: missing $-> properties can remove rows before OR/NOT/IS NULL.\n-- Use the appropriate model/aspect/class table for non-element instances.\nSELECT ECInstanceId, ECClassId FROM bis.Element WHERE ${where}`;
}

type Truth = boolean | null;
function matchesLike(text: string, pattern: string): boolean {
  const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const input = [...fold(text)], template = [...fold(pattern)];
  let i = 0, p = 0, wildcard = -1, restart = 0;
  while (i < input.length) {
    if (template[p] === "_" || (template[p] !== "%" && template[p] === input[i])) { i++; p++; }
    else if (template[p] === "%") { wildcard = p++; restart = i; }
    else if (wildcard >= 0) { p = wildcard + 1; i = ++restart; }
    else return false;
  }
  while (template[p] === "%") p++;
  return p === template.length;
}

export function evaluateExpression(expr: NodeExpr, node: Pick<GraphNode, NodeField>, properties: Readonly<Record<string, Scalar>> = {}): Truth {
  const value = (o: Operand): Scalar => {
    if ("literal" in o) return o.literal;
    if ("field" in o) return node[o.field] ?? null;
    if (o.prop.toLowerCase() === "ecinstanceid") return node.id;
    if (o.prop.toLowerCase() === "ecclassid") return node.classId;
    return properties[o.prop] ?? null;
  };
  const equals = (a: Scalar, b: Scalar): Truth => a === null || b === null ? null : a === b;
  const run = (e: NodeExpr): Truth => {
    switch (e.kind) {
      case "and": {
        const values = e.args.map(run);
        return values.includes(false) ? false : values.includes(null) ? null : true;
      }
      case "or": {
        const values = e.args.map(run);
        return values.includes(true) ? true : values.includes(null) ? null : false;
      }
      case "not": { const r = run(e.arg); return r === null ? null : !r; }
      case "isNull": return value(e.operand) === null;
      case "isNotNull": return value(e.operand) !== null;
      case "in": {
        const results = e.values.map((v) => equals(value(e.left), v));
        return results.includes(true) ? true : results.includes(null) ? null : false;
      }
      case "like": {
        const a = value(e.left), b = value(e.right);
        if (a === null || b === null) return null;
        if (typeof a !== "string" || typeof b !== "string") throw new Error("LIKE requires string operands");
        // SQLite LIKE folds ASCII only; use a wildcard matcher rather than user-driven regex.
        return matchesLike(a, b);
      }
      case "compare": {
        const a = value(e.left), b = value(e.right);
        if (a === null || b === null) return null;
        if (typeof a !== typeof b) throw new Error("Comparison operands have incompatible types");
        switch (e.op) {
          case "=": return a === b;
          case "!=": return a !== b;
          case "<": return a < b;
          case "<=": return a <= b;
          case ">": return a > b;
          case ">=": return a >= b;
        }
      }
    }
  };
  return run(expr);
}
