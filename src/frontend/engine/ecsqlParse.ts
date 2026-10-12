import { BooleanExpr, ClassRefExpr, ComputedExpr, type NativeECSqlParseNode, StatementExpr, ValueExpr } from "@itwin/ecsql-common";
import { EXPERIMENTAL_OPTION } from "./ecsql";
import type { IModelQueryPort } from "./IModelQueryPort";

/** A node of the JSON tree produced by native `PRAGMA PARSE_TREE`. */
export type NativeNode = NativeECSqlParseNode;

export type AnalyseResult = { tree: NativeNode; error?: undefined } | { tree?: undefined; error: string };

/** Trims whitespace and a trailing `;`, which `PRAGMA PARSE_TREE` and the query reader both reject. */
export function normaliseStatement(ecsql: string): string {
  return ecsql.trim().replace(/;\s*$/, "").trim();
}

const SELECT_START = /^\s*(SELECT|WITH|VALUES|\()/i;
const SELECT_ROOTS = new Set(["SelectStatementExp", "CommonTableExp"]);

/** Native semantic parse tree, or `undefined` when the statement does not prepare (native reports no
 * reason through the PRAGMA, see {@link diagnose}). */
export async function parseTree(port: IModelQueryPort, ecsql: string): Promise<NativeNode | undefined> {
  const text = normaliseStatement(ecsql);
  const rows = await port.query(`PRAGMA PARSE_TREE("${text.replace(/"/g, "\"\"")}") ${EXPERIMENTAL_OPTION}`);
  const json: unknown = rows[0]?.val;
  if (typeof json !== "string" || json === "")
    return undefined;
  return JSON.parse(json) as NativeNode;
}

/** Native wraps prepare errors as `Failed to parse ECSQL '<wrapped statement>': <reason>`. */
export function cleanQueryError(message: string): string {
  const wrapped = /^Failed to parse ECSQL '[\s\S]*': ([^']*)$/.exec(message);
  return wrapped ? wrapped[1] : message;
}

/** Prepares (and steps at most one row of) a SELECT to obtain the native error message. */
export async function diagnose(port: IModelQueryPort, ecsql: string): Promise<string | undefined> {
  const text = normaliseStatement(ecsql);
  if (!SELECT_START.test(text))
    return "Only SELECT statements are supported.";
  try {
    await port.query(text, undefined, { limit: 1 });
    return undefined;
  } catch (e) {
    return cleanQueryError(e instanceof Error ? e.message : String(e));
  }
}

/** Parses a SELECT statement. Errors carry the native message whenever one is available. */
export async function analyse(port: IModelQueryPort, ecsql: string): Promise<AnalyseResult> {
  const text = normaliseStatement(ecsql);
  if (!text)
    return { error: "The query is empty." };
  if (!SELECT_START.test(text))
    return { error: "Only SELECT statements are supported." };
  let tree: NativeNode | undefined;
  try {
    tree = await parseTree(port, text);
  } catch (e) {
    return { error: cleanQueryError(e instanceof Error ? e.message : String(e)) };
  }
  if (!tree)
    return { error: await diagnose(port, text) ?? "The query could not be parsed." };
  if (!SELECT_ROOTS.has(String(tree.id)))
    return { error: "Only SELECT statements are supported." };
  return { tree };
}

// ---------------------------------------------------------------------------------------------
// Printing native subtrees as ECSQL text

const KEYWORDS = new Set(`ABSOLUTE ACTION ADD ALL ALLOCATE ALTER AND ANY ARE AS ASC ASSERTION AT AUTHORIZATION AVG
BACKWARD BEGIN BETWEEN BINARY BIT BLOB BOOLEAN BOTH BY CASCADE CASCADED CASE CAST CATALOG CHAR CHARACTER CHECK
CLOSE COALESCE COLLATE COLLATION COLUMN COMMIT CONNECT CONNECTION CONSTRAINT CONSTRAINTS CONTINUE CONVERT
CORRESPONDING COUNT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATE DAY
DEALLOCATE DEC DECIMAL DECLARE DEFAULT DEFERRABLE DEFERRED DELETE DESC DESCRIBE DESCRIPTOR DIAGNOSTICS DISCONNECT
DISTINCT DOMAIN DOUBLE DROP ECSQLOPTIONS ELSE END ESCAPE EXCEPT EXCEPTION EXCLUDE EXEC EXECUTE EXISTS EXTERNAL
EXTRACT FALSE FETCH FILTER FIRST FLOAT FOLLOWING FOR FOREIGN FORWARD FOUND FROM FULL GET GLOBAL GO GOTO GRANT GROUP
GROUPS HAVING HOUR IDENTITY IIF IMMEDIATE IN INDICATOR INITIALLY INNER INPUT INSENSITIVE INSERT INT INTEGER
INTERSECT INTERVAL INTO IS ISOLATION JOIN KEY LANGUAGE LAST LEADING LEFT LEVEL LIKE LIMIT LOCAL LOWER MATCH MAX MIN
MINUTE MODULE MONTH NAMES NATIONAL NATURAL NCHAR NEXT NO NOT NULL NULLIF NULLS NUMERIC OF OFFSET ON ONLY OPEN OPTION
OR ORDER OTHERS OUTER OUTPUT OVER OVERLAPS PAD PARTIAL PARTITION POSITION PRAGMA PRECEDING PRECISION PREPARE
PRESERVE PRIMARY PRIOR PRIVILEGES PROCEDURE PUBLIC RANGE READ REAL RECURSIVE REFERENCES RELATIVE RESTRICT REVOKE
RIGHT ROLLBACK ROW ROWS SCHEMA SCROLL SECOND SECTION SELECT SESSION SESSION_USER SET SIZE SMALLINT SOME SPACE SQL
SQLCODE SQLERROR SQLSTATE SUBSTRING SUM SYSTEM_USER TABLE TEMPORARY THEN TIES TIME TIMESTAMP TIMEZONE_HOUR
TIMEZONE_MINUTE TO TRAILING TRANSACTION TRANSLATE TRANSLATION TRIM TRUE UNBOUNDED UNION UNIQUE UNKNOWN UPDATE UPPER
USAGE USER USING VALUE VALUES VARCHAR VARYING VIEW WHEN WHENEVER WHERE WINDOW WITH WORK WRITE YEAR ZONE`.split(/\s+/));

/** Quotes an identifier with `[ ]` only when it is not a plain, non-reserved identifier. */
export function quoteIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name.toUpperCase()) ? name : `[${name.replace(/]/g, "]]")}]`;
}

/** `a.Model.Id` → each segment quoted only where needed. */
export function formatPath(path: string): string {
  return path.split(".").map(quoteIdentifier).join(".");
}

/** Removes the defensive `[ ]` that ecsql-common puts around every identifier, keeping them where an
 * identifier needs quoting. String literals and `"…"` identifiers are copied verbatim. */
export function unbracket(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === "\"") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "[") {
      const end = sql.indexOf("]", i + 1);
      if (end < 0) { out += sql.slice(i); break; }
      out += quoteIdentifier(sql.slice(i + 1, end));
      i = end + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function isNode(value: unknown): value is NativeNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function raw(value: string): NativeNode {
  return { id: "LiteralValueExp", kind: "RAW", value };
}

function frameBound(node: NativeNode, prefix: "First" | "Second" | "Start"): string {
  const type = String(node[prefix === "Start" ? "WindowFrameStartType" : `${prefix}WindowFrameBoundType`]);
  const valueNode = node[prefix === "Start" ? "WindowFrameStartValue" : `${prefix}WindowFrameBoundValueExp`];
  const m = /^VALUE (PRECEDING|FOLLOWING)$/.exec(type);
  if (m) {
    if (!isNode(valueNode))
      throw new Error(`Window frame bound '${type}' has no value.`);
    return `${printValue(valueNode)} ${m[1]}`;
  }
  return type;
}

function printWindowSpec(spec: NativeNode): string {
  const parts: string[] = [];
  if (typeof spec.WindowName === "string")
    parts.push(quoteIdentifier(spec.WindowName));
  if (Array.isArray(spec.PartitionByExp)) {
    parts.push(`PARTITION BY ${spec.PartitionByExp.map((p: NativeNode) =>
      `${printValue(p.ColumnRef as NativeNode)}${typeof p.CollateClauseFunction === "string" && p.CollateClauseFunction ? ` COLLATE ${p.CollateClauseFunction}` : ""}`).join(", ")}`);
  }
  if (Array.isArray(spec.OrderBy))
    parts.push(`ORDER BY ${spec.OrderBy.map((o: NativeNode) => `${printValue(o.exp as NativeNode)}${o.direction ? ` ${String(o.direction)}` : ""}`).join(", ")}`);
  const frame = spec.WindowFrameClauseExp;
  if (isNode(frame)) {
    if (frame.WindowFrameExclusion !== undefined)
      throw new Error("Window frame EXCLUDE clauses are not reported by the native parse tree.");
    const between = frame.WindowFrameBetweenExp;
    const start = frame.WindowFrameStartExp;
    if (isNode(between))
      parts.push(`${String(frame.WindowFrameUnit)} BETWEEN ${frameBound(between.FirstWindowFrameBoundExp as NativeNode, "First")} AND ${frameBound(between.SecondWindowFrameBoundExp as NativeNode, "Second")}`);
    else if (isNode(start))
      parts.push(`${String(frame.WindowFrameUnit)} ${frameBound(start, "Start")}`);
    else
      throw new Error("Unrecognised window frame.");
  }
  return parts.join(" ");
}

function printWindowFunction(node: NativeNode): string {
  let text = printValue(node.WindowFunctionCallExp as NativeNode);
  if (isNode(node.FilterExp))
    text += ` FILTER (WHERE ${printComputed(node.FilterExp.WhereExp as NativeNode)})`;
  if (isNode(node.WindowSpecificationExp))
    text += ` OVER (${printWindowSpec(node.WindowSpecificationExp)})`;
  else if (typeof node.WindowName === "string")
    text += ` OVER ${quoteIdentifier(node.WindowName)}`;
  return text;
}

/** Rewrites nodes ecsql-common 5.14 cannot deserialise into equivalent nodes it can. */
function prepare(node: unknown): unknown {
  if (Array.isArray(node))
    return node.map(prepare);
  if (!isNode(node))
    return node;
  if (node.id === "WindowFunctionExp")
    return raw(printWindowFunction(node));
  const out: NativeNode = {};
  for (const [key, value] of Object.entries(node))
    out[key] = prepare(value);
  // ecsql-common recognises BETWEEN only as an op ending in " BETWEEN"; native emits plain "BETWEEN".
  if (out.id === "BinaryBooleanExp" && out.op === "BETWEEN")
    out.op = " BETWEEN";
  return out;
}

export function printValue(node: NativeNode): string {
  return unbracket(ValueExpr.deserialize(prepare(node) as NativeNode).toECSql());
}

export function printComputed(node: NativeNode): string {
  return unbracket(ComputedExpr.deserialize(prepare(node) as NativeNode).toECSql());
}

export function printBoolean(node: NativeNode): string {
  return unbracket(BooleanExpr.deserialize(prepare(node) as NativeNode).toECSql());
}

export function printClassRef(node: NativeNode): string {
  return unbracket(ClassRefExpr.deserialize(prepare(node) as NativeNode).toECSql());
}

export function printStatement(node: NativeNode): string {
  return unbracket(StatementExpr.deserialize(prepare(node) as NativeNode).toECSql());
}
