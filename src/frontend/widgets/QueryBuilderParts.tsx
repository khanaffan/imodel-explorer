import { Button } from "@itwin/itwinui-react";
import { useId, useState } from "react";
import type { Row } from "../engine/IModelQueryPort";
import type { NativeNode } from "../engine/ecsqlParse";
import { type FieldType, formatLiteral, literalDisplay, operatorsFor, type PropertyField } from "../engine/queryContext";
import { type Cond, PRED_ARITY, type PredOp } from "../engine/queryModel";

/** Resolves an expression such as `e.Model.Id` to the property it names, when it names one. */
export type FieldLookup = (expr: string) => PropertyField | undefined;

const ALL_OPS = Object.keys(PRED_ARITY) as PredOp[];

/** One operand: typed value box (formatted with {@link formatLiteral}) or free ECSQL expression. */
export function ArgInput({ type, field, op, value, label, onChange }: {
  type: FieldType; field?: PropertyField; op: PredOp; value: string; label: string; onChange: (ecsql: string) => void;
}) {
  const shown = literalDisplay(type, value, field, op);
  const [mode, setMode] = useState<"value" | "expr">(value.trim() && shown === undefined ? "expr" : "value");
  const [text, setText] = useState(mode === "value" ? shown ?? "" : value);
  const [error, setError] = useState<string>();
  const enumChoice = mode === "value" && type === "enum" && field?.enumValues && op !== "IS" && op !== "IS NOT";
  const boolChoice = mode === "value" && type === "boolean";
  const edit = (next: string) => {
    setText(next);
    if (mode === "expr") { setError(undefined); onChange(next); return; }
    if (!next.trim()) { setError(undefined); onChange(""); return; }
    const r = formatLiteral(type, next, field, op);
    if (r.ok) { setError(undefined); onChange(r.ecsql); } else setError(r.error);
  };
  const placeholder = mode === "expr" ? "ECSQL expression" : type === "dateTime" ? "YYYY-MM-DD" : type === "id" ? "0x…" : (op === "IS" || op === "IS NOT") ? "Schema:Class" : type === "string" && op.includes("LIKE") ? "%text%" : "value";
  return (
    <span className="ig-qb-arg">
      {enumChoice ? (
        <select aria-label={label} value={text} onChange={(e) => edit(e.target.value)}>
          <option value="">—</option>
          {field.enumValues?.map((v) => <option key={String(v.value)} value={v.label}>{v.label}</option>)}
        </select>
      ) : boolChoice ? (
        <select aria-label={label} value={text} onChange={(e) => edit(e.target.value)}>
          <option value="">—</option><option value="true">true</option><option value="false">false</option>
        </select>
      ) : (
        <input aria-label={label} className={error ? "ig-qb-invalid" : undefined} title={error} placeholder={placeholder}
          value={text} onChange={(e) => edit(e.target.value)} />
      )}
      <button type="button" className="ig-qb-mode" aria-pressed={mode === "expr"}
        title={mode === "expr" ? "Switch to a typed value" : "Switch to an ECSQL expression (column, function, parameter…)"}
        onClick={() => {
          const next = mode === "expr" ? "value" : "expr";
          setMode(next);
          setError(undefined);
          setText(next === "expr" ? value : literalDisplay(type, value, field, op) ?? "");
          if (next === "value" && literalDisplay(type, value, field, op) === undefined) onChange("");
        }}>ƒx</button>
      {error && <small className="ig-qb-error">{error}</small>}
    </span>
  );
}

function PredEditor({ cond, lookup, fieldList, onChange }: {
  cond: Extract<Cond, { kind: "pred" }>; lookup: FieldLookup; fieldList: string; onChange: (c: Cond) => void;
}) {
  const field = lookup(cond.left);
  const type: FieldType = field?.type ?? "any";
  const ops = field ? operatorsFor(type) : ALL_OPS;
  const opChoices = ops.includes(cond.op) ? ops : [cond.op, ...ops];
  const arity = PRED_ARITY[cond.op];
  const count = arity === "n" ? Math.max(1, cond.args.length) : arity;
  const args = Array.from({ length: count }, (_, i) => cond.args[i] ?? "");
  // Remount operands when the meaning of the operand changes so local text and mode reset.
  const argKey = `${type}|${cond.op}`;
  return (
    <span className="ig-qb-pred">
      <input aria-label="Left operand" className="ig-qb-left" list={fieldList} value={cond.left}
        onChange={(e) => onChange({ ...cond, left: e.target.value })} />
      <select aria-label="Operator" value={cond.op} onChange={(e) => {
        const op = e.target.value as PredOp;
        const a = PRED_ARITY[op];
        onChange({ ...cond, op, args: a === 0 ? [] : a === "n" ? cond.args : cond.args.slice(0, a) });
      }}>{opChoices.map((o) => <option key={o}>{o}</option>)}</select>
      {args.map((arg, i) => (
        <span key={`${argKey}|${i}`} className="ig-qb-argwrap">
          {i > 0 && <span className="ig-qb-sep">{arity === 2 ? "AND" : ","}</span>}
          <ArgInput type={type} field={field} op={cond.op} value={arg} label={`Value ${i + 1}`}
            onChange={(v) => onChange({ ...cond, args: args.map((x, j) => j === i ? v : x) })} />
          {arity === "n" && args.length > 1 && <button type="button" className="ig-qb-x" aria-label={`Remove value ${i + 1}`}
            onClick={() => onChange({ ...cond, args: args.filter((_, j) => j !== i) })}>×</button>}
        </span>
      ))}
      {arity === "n" && <button type="button" className="ig-qb-mini" onClick={() => onChange({ ...cond, args: [...args, ""] })}>+ value</button>}
    </span>
  );
}

/** Recursive WHERE/HAVING editor: AND/OR groups, NOT, typed predicates and editable raw chips. */
export function CondEditor({ cond, lookup, fieldList, onChange, onRemove, depth = 0 }: {
  cond: Cond; lookup: FieldLookup; fieldList: string; onChange: (c: Cond) => void; onRemove?: () => void; depth?: number;
}) {
  const remove = onRemove && <button type="button" className="ig-qb-x" aria-label="Remove condition" onClick={onRemove}>×</button>;
  switch (cond.kind) {
    case "pred":
      return <div className="ig-qb-cond"><PredEditor cond={cond} lookup={lookup} fieldList={fieldList} onChange={onChange} />
        <button type="button" className="ig-qb-mini" title="Negate" onClick={() => onChange({ kind: "not", item: cond })}>NOT</button>{remove}</div>;
    case "raw":
      return <div className="ig-qb-cond ig-qb-chip" title="Kept as ECSQL text: the builder has no visual form for this part.">
        <span className="ig-qb-chiptag">ECSQL</span>
        <input aria-label="ECSQL condition" value={cond.ecsql} onChange={(e) => onChange({ kind: "raw", ecsql: e.target.value })} />{remove}</div>;
    case "not":
      return <div className="ig-qb-cond ig-qb-not"><span className="ig-qb-chiptag">NOT</span>
        <CondEditor cond={cond.item} lookup={lookup} fieldList={fieldList} depth={depth + 1} onChange={(item) => onChange({ kind: "not", item })} />
        <button type="button" className="ig-qb-mini" onClick={() => onChange(cond.item)}>Remove NOT</button>{remove}</div>;
    case "group":
      return (
        <div className={`ig-qb-group ig-qb-group--${depth % 2 ? "odd" : "even"}`}>
          <div className="ig-qb-grouphead">
            <select aria-label="Combine with" value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value === "OR" ? "OR" : "AND" })}>
              <option value="AND">All of (AND)</option><option value="OR">Any of (OR)</option>
            </select>
            <button type="button" className="ig-qb-mini" onClick={() => onChange({ ...cond, items: [...cond.items, { kind: "pred", left: "", op: "=", args: [] }] })}>+ condition</button>
            <button type="button" className="ig-qb-mini" onClick={() => onChange({ ...cond, items: [...cond.items, { kind: "group", op: cond.op === "AND" ? "OR" : "AND", items: [] }] })}>+ group</button>
            <button type="button" className="ig-qb-mini" onClick={() => onChange({ ...cond, items: [...cond.items, { kind: "raw", ecsql: "" }] })}>+ ECSQL</button>
            {remove}
          </div>
          {cond.items.length === 0 && <small className="ig-qb-muted">No conditions.</small>}
          {cond.items.map((item, i) => (
            <CondEditor key={i} cond={item} lookup={lookup} fieldList={fieldList} depth={depth + 1}
              onChange={(c) => onChange({ ...cond, items: cond.items.map((x, j) => j === i ? c : x) })}
              onRemove={() => onChange({ ...cond, items: cond.items.filter((_, j) => j !== i) })} />
          ))}
        </div>
      );
  }
}

function TreeNode({ name, value }: { name: string; value: unknown }) {
  if (value === null || typeof value !== "object")
    return <div className="ig-qb-tree-leaf"><span className="ig-qb-tree-key">{name}</span>: <code>{JSON.stringify(value)}</code></div>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value).filter(([k]) => k !== "id");
  const id = !Array.isArray(value) && "id" in value ? String((value as NativeNode).id) : undefined;
  return (
    <details open>
      <summary><span className="ig-qb-tree-key">{name}</span>{id && <> <strong>{id}</strong></>}{Array.isArray(value) && ` [${value.length}]`}</summary>
      <div className="ig-qb-tree-children">{entries.map(([k, v]) => <TreeNode key={k} name={k} value={v} />)}</div>
    </details>
  );
}

export function ParseTreeView({ tree }: { tree?: NativeNode }) {
  if (!tree) return <p className="ig-qb-muted">No parse tree: the query is invalid or still being checked.</p>;
  return <div className="ig-qb-tree" aria-label="Parse tree"><TreeNode name="statement" value={tree} /></div>;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function ResultsTable({ rows }: { rows: readonly Row[] }) {
  const captionId = useId();
  if (rows.length === 0) return <p className="ig-qb-muted">No rows.</p>;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    <div className="ig-qb-results">
      <table aria-describedby={captionId}>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody>
      </table>
      <small id={captionId}>{rows.length} row{rows.length === 1 ? "" : "s"} (at most 100 are fetched).</small>
    </div>
  );
}

export function ListEditor({ label, items, fieldList, onChange, render }: {
  label: string; items: readonly string[]; fieldList: string; onChange: (items: string[]) => void;
  render?: (i: number) => React.ReactNode;
}) {
  return (
    <div className="ig-qb-list">
      {items.map((it, i) => (
        <div key={i} className="ig-qb-listrow">
          <input aria-label={`${label} ${i + 1}`} list={fieldList} value={it} onChange={(e) => onChange(items.map((x, j) => j === i ? e.target.value : x))} />
          {render?.(i)}
          <button type="button" className="ig-qb-x" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <Button size="small" styleType="borderless" onClick={() => onChange([...items, ""])}>+ {label}</Button>
    </div>
  );
}
