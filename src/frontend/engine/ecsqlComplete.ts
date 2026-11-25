import type { SchemaView } from "@itwin/ecschema-metadata";
import type { ClassRegistry } from "./ClassRegistry";
import { type PropertyField, propertyGroups } from "./queryContext";

export type CompletionKind = "keyword" | "schema" | "class" | "relationship" | "property" | "alias" | "function";

export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
  readonly kind: CompletionKind;
  readonly detail?: string;
}

export interface CompletionResult {
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly items: readonly CompletionItem[];
}

const MAX_ITEMS = 40;

const ECSQL_KEYWORDS: readonly string[] = [
  "SELECT", "DISTINCT", "FROM", "ONLY", "WHERE", "JOIN", "LEFT JOIN", "INNER JOIN",
  "USING", "ON", "AS", "AND", "OR", "NOT", "IN", "LIKE", "IS NULL", "IS NOT NULL",
  "BETWEEN", "ORDER BY", "ASC", "DESC", "GROUP BY", "HAVING", "LIMIT", "OFFSET",
  "WITH", "UNION", "UNION ALL", "INTERSECT", "EXCEPT", "FORWARD", "BACKWARD",
  "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "TRUE", "FALSE", "NULL",
];

const ECSQL_FUNCTIONS: ReadonlyArray<{ name: string; detail: string }> = [
  { name: "COUNT()", detail: "aggregate" },
  { name: "SUM()", detail: "aggregate" },
  { name: "MIN()", detail: "aggregate" },
  { name: "MAX()", detail: "aggregate" },
  { name: "AVG()", detail: "aggregate" },
  { name: "LOWER()", detail: "string" },
  { name: "UPPER()", detail: "string" },
  { name: "COALESCE()", detail: "null handling" },
  { name: "ec_classname()", detail: "ECClassId → name" },
  { name: "ec_classid()", detail: "name → ECClassId" },
  { name: "iif()", detail: "conditional" },
];

const CLAUSE_STOPWORDS = new Set([
  "SELECT", "DISTINCT", "FROM", "ONLY", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS", "NATURAL",
  "USING", "ON", "AS", "AND", "OR", "NOT", "IN", "LIKE", "IS", "NULL", "BETWEEN",
  "ORDER", "BY", "ASC", "DESC", "GROUP", "HAVING", "LIMIT", "OFFSET", "WITH",
  "UNION", "INTERSECT", "EXCEPT", "FORWARD", "BACKWARD", "SET", "VALUES",
]);

interface SourceRef {
  readonly className: string;
  readonly alias?: string;
}

/** True when `cursor` falls inside a single-quoted string, `--` line comment, or block comment. */
function isInsideLiteralOrComment(sql: string, cursor: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < cursor; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i++; }
    } else if (inSingle) {
      if (ch === "'" && next === "'") i++;
      else if (ch === "'") inSingle = false;
    } else if (inDouble) {
      if (ch === '"' && next === '"') i++;
      else if (ch === '"') inDouble = false;
    } else {
      if (ch === "-" && next === "-") { inLineComment = true; i++; }
      else if (ch === "/" && next === "*") { inBlockComment = true; i++; }
      else if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
    }
  }
  return inSingle || inLineComment || inBlockComment;
}

/** Extract `Schema.Class` / `Schema:Class` sources and optional aliases from FROM / JOIN / USING clauses. */
function extractSources(sql: string): SourceRef[] {
  const refs: SourceRef[] = [];
  const re = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([A-Za-z_]\w*[:.][A-Za-z_]\w*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const className = m[1].replace(".", ":");
    const rawAlias = m[2];
    const alias = rawAlias && !CLAUSE_STOPWORDS.has(rawAlias.toUpperCase()) ? rawAlias : undefined;
    refs.push({ className, alias });
  }
  return refs;
}

function allPropertiesOf(registry: ClassRegistry, className: string): PropertyField[] {
  const out: PropertyField[] = [];
  const seen = new Set<string>();
  for (const group of propertyGroups(registry, className)) {
    for (const field of group.fields) {
      if (seen.has(field.path)) continue;
      seen.add(field.path);
      out.push(field);
    }
  }
  return out;
}

function resolveSchema(view: SchemaView, nameOrAlias: string): SchemaView.Schema | undefined {
  return view.getSchema(nameOrAlias) ?? view.getSchemaByAlias(nameOrAlias);
}

function filterAndRank(items: CompletionItem[], prefix: string): CompletionItem[] {
  const q = prefix.toLowerCase();
  if (!q) return items.slice(0, MAX_ITEMS);
  const starts: CompletionItem[] = [];
  const contains: CompletionItem[] = [];
  for (const item of items) {
    const low = item.label.toLowerCase();
    if (low.startsWith(q)) starts.push(item);
    else if (low.includes(q)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, MAX_ITEMS);
}

function findPrevKeywords(beforeToken: string): { last?: string; prev?: string } {
  const tokens = beforeToken.trimEnd().match(/[A-Za-z_]\w*/g);
  if (!tokens || tokens.length === 0) return {};
  return {
    last: tokens[tokens.length - 1]?.toUpperCase(),
    prev: tokens.length >= 2 ? tokens[tokens.length - 2]?.toUpperCase() : undefined,
  };
}

function schemaClassItems(schema: SchemaView.Schema, relationshipsOnly: boolean): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const cls of schema.getClasses()) {
    const isRel = cls.isRelationship();
    if (relationshipsOnly && !isRel) continue;
    if (!isRel && !cls.isEntity() && !cls.isMixin()) continue;
    items.push({
      label: cls.name,
      insertText: cls.name,
      kind: isRel ? "relationship" : "class",
      detail: isRel ? "relationship" : cls.isMixin() ? "mixin" : cls.isAbstract ? "abstract entity" : "entity",
    });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

/** Compute schema-aware ECSQL completions at `cursor`. */
export function completeEcsql(sql: string, cursor: number, registry?: ClassRegistry): CompletionResult {
  const pos = Math.max(0, Math.min(cursor, sql.length));
  if (isInsideLiteralOrComment(sql, pos)) {
    return { replaceStart: pos, replaceEnd: pos, items: [] };
  }

  const before = sql.slice(0, pos);
  const sources = extractSources(sql);

  // 1. Qualified completion: `prefix.partial` or `prefix:partial` (including `alias.nav.partial` and trailing `.` / `:`)
  const qualMatch = before.match(/((?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*)([.:])([A-Za-z_]\w*)?$/);
  if (qualMatch && registry) {
    const qualifier = qualMatch[1];
    const sep = qualMatch[2];
    const partial = qualMatch[3] ?? "";
    const replaceStart = pos - partial.length;
    const beforeQual = before.slice(0, pos - qualMatch[0].length);
    const { last: prevKw, prev: prevPrevKw } = findPrevKeywords(beforeQual);
    const inUsing = prevKw === "USING" || (prevKw === "ONLY" && prevPrevKw === "USING");

    // 1a. `alias.navProp.` -> sub-members (.Id, .RelECClassId, .X/.Y/.Z)
    if (qualifier.includes(".") && sep === ".") {
      const [aliasName, propName] = qualifier.split(".");
      const src = sources.find((s) => s.alias?.toLowerCase() === aliasName.toLowerCase());
      if (src) {
        const field = allPropertiesOf(registry, src.className).find((f) => f.path.toLowerCase() === propName.toLowerCase());
        if (field?.members) {
          const items: CompletionItem[] = field.members.map((m) => {
            const sub = m.path.split(".").pop() ?? m.path;
            return { label: sub, insertText: sub, kind: "property", detail: m.type };
          });
          return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
        }
      }
      return { replaceStart, replaceEnd: pos, items: [] };
    }

    // 1b. `Schema.` or `Schema:` -> classes in that schema
    const schema = resolveSchema(registry.view, qualifier);
    if (schema) {
      const items = schemaClassItems(schema, inUsing);
      return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
    }

    // 1c. `alias.` -> properties of the alias's class
    if (sep === ".") {
      const src = sources.find((s) => s.alias?.toLowerCase() === qualifier.toLowerCase());
      if (src) {
        const items: CompletionItem[] = allPropertiesOf(registry, src.className).map((f) => ({
          label: f.path,
          insertText: f.path,
          kind: "property",
          detail: f.type,
        }));
        return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
      }

      // 1d. `NavProp.` or `PointProp.` directly on a referenced class
      for (const s of sources) {
        const field = allPropertiesOf(registry, s.className).find((f) => f.path.toLowerCase() === qualifier.toLowerCase());
        if (field?.members) {
          const items: CompletionItem[] = field.members.map((m) => {
            const sub = m.path.split(".").pop() ?? m.path;
            return { label: sub, insertText: sub, kind: "property", detail: m.type };
          });
          return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
        }
      }
    }

    return { replaceStart, replaceEnd: pos, items: [] };
  }

  // 2. Unqualified identifier token at cursor
  const wordMatch = before.match(/([A-Za-z_]\w*)$/);
  const partial = wordMatch ? wordMatch[1] : "";
  const replaceStart = pos - partial.length;
  const beforeWord = before.slice(0, replaceStart);
  const { last: prevKw, prev: prevPrevKw } = findPrevKeywords(beforeWord);

  // 2a. Class / schema position: right after FROM [ONLY], JOIN [ONLY], USING [ONLY]
  const inFromOrJoin = prevKw === "FROM" || prevKw === "JOIN" || (prevKw === "ONLY" && (prevPrevKw === "FROM" || prevPrevKw === "JOIN"));
  const inUsing = prevKw === "USING" || (prevKw === "ONLY" && prevPrevKw === "USING");
  if ((inFromOrJoin || inUsing) && registry) {
    const items: CompletionItem[] = [];
    if (prevKw !== "ONLY") {
      items.push({ label: "ONLY", insertText: "ONLY ", kind: "keyword", detail: "exact class (no subclasses)" });
    }
    const schemas = [...registry.view.getSchemas()].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of schemas) {
      let count = 0;
      for (const c of s.getClasses()) {
        if (inUsing ? c.isRelationship() : (c.isEntity() || c.isMixin() || c.isRelationship())) count++;
      }
      if (count > 0) {
        items.push({ label: `${s.name}.`, insertText: `${s.name}.`, kind: "schema", detail: `schema (${count})` });
      }
    }
    // Also offer full Schema.Class completions so typing "Pump" finds "TestIG.Pump"
    for (const s of schemas) {
      for (const cls of s.getClasses()) {
        const isRel = cls.isRelationship();
        if (inUsing && !isRel) continue;
        if (!isRel && !cls.isEntity() && !cls.isMixin()) continue;
        const full = `${s.name}.${cls.name}`;
        items.push({
          label: full,
          insertText: full,
          kind: isRel ? "relationship" : "class",
          detail: isRel ? "relationship" : cls.isMixin() ? "mixin" : "entity",
        });
      }
    }
    return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
  }

  // 2b. General / expression position: properties of referenced classes, aliases, functions, keywords
  const items: CompletionItem[] = [];
  const seenLabels = new Set<string>();

  for (const s of sources) {
    if (s.alias && !seenLabels.has(s.alias.toLowerCase())) {
      seenLabels.add(s.alias.toLowerCase());
      items.push({ label: s.alias, insertText: s.alias, kind: "alias", detail: s.className });
    }
  }

  if (registry) {
    for (const s of sources) {
      for (const field of allPropertiesOf(registry, s.className)) {
        const key = field.path.toLowerCase();
        if (seenLabels.has(key)) continue;
        seenLabels.add(key);
        items.push({
          label: field.path,
          insertText: field.path,
          kind: "property",
          detail: `${field.type} · ${s.className.split(":").pop()}`,
        });
      }
    }
  }

  for (const kw of ECSQL_KEYWORDS) {
    if (seenLabels.has(kw.toLowerCase())) continue;
    seenLabels.add(kw.toLowerCase());
    items.push({ label: kw, insertText: kw, kind: "keyword" });
  }

  for (const fn of ECSQL_FUNCTIONS) {
    items.push({ label: fn.name, insertText: fn.name, kind: "function", detail: fn.detail });
  }

  return { replaceStart, replaceEnd: pos, items: filterAndRank(items, partial) };
}
