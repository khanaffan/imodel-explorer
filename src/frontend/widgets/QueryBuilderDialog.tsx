import "@xyflow/react/dist/style.css";
import "./queryBuilder.css";
import { Button, Modal, ModalButtonBar, ModalContent } from "@itwin/itwinui-react";
import {
  Background, Controls, type Edge, Handle, type Node, type NodeProps, Position, ReactFlow, ReactFlowProvider,
  useNodesInitialized, useReactFlow,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ClassRegistry } from "../engine/ClassRegistry";
import { analyse, cleanQueryError, type NativeNode } from "../engine/ecsqlParse";
import type { IModelQueryPort, Row } from "../engine/IModelQueryPort";
import {
  addSource, andCond, applyJoin, classChoices, classLocalName, connectingSuggestions, connectSources, describeSources,
  findField, type JoinForm, type JoinSuggestion, joinSuggestions, operatorsFor, type PropertyField, type PropertyGroup,
  sourceFields,
} from "../engine/queryContext";
import {
  type CompoundOp, type Cond, docFromNative, ensureAlias, makeAlias, printCond, printDoc, propertyRef,
  type QueryDoc, referencesQualifier, removeFromItem, removeJoin, renameAlias, type SelectChain, type SelectModel,
  selectFromClass, type Source, usedAliases, type JoinType,
} from "../engine/queryModel";
import { quoteIdentifier } from "../engine/ecsqlParse";
import { CondEditor, type FieldLookup, ListEditor, ParseTreeView, ResultsTable } from "./QueryBuilderParts";

export interface QueryCounts {
  readonly classes: ReadonlyMap<string, number>;
  readonly relationships: ReadonlyMap<string, number>;
}

export interface QueryBuilderDialogProps {
  readonly port: IModelQueryPort;
  readonly registry: ClassRegistry;
  readonly initialEcsql: string;
  /** Instance counts used to rank class and relationship suggestions. */
  readonly loadCounts?: () => Promise<QueryCounts>;
  readonly onUse: (ecsql: string, run: boolean) => void;
  readonly onClose: () => void;
}

interface Scope { readonly cte?: number; readonly part: number }

const DEFAULT_CLASS = "BisCore:Element";
const COMPOUND_OPS: readonly CompoundOp[] = ["UNION", "UNION ALL", "INTERSECT", "EXCEPT"];
const JOIN_TYPES: readonly JoinType[] = ["INNER", "LEFT", "RIGHT", "FULL"];
const FORM_LABEL: Record<JoinForm, string> = {
  navigation: "Navigation property (fastest)",
  linkTable: "Through the relationship class",
  using: "JOIN … USING relationship",
};
const AGGREGATES = ["COUNT", "SUM", "MIN", "MAX", "AVG", "GROUP_CONCAT"] as const;

function newDoc(className = DEFAULT_CLASS): QueryDoc {
  return { recursive: false, ctes: [], main: { first: selectFromClass(className), rest: [] } };
}

function chainOf(doc: QueryDoc, scope: Scope): SelectChain {
  return scope.cte === undefined ? doc.main : doc.ctes[scope.cte].query;
}

function selectOf(chain: SelectChain, part: number): SelectModel {
  return part === 0 ? chain.first : chain.rest[part - 1].select;
}

function clampScope(doc: QueryDoc, scope: Scope): Scope {
  const cte = scope.cte !== undefined && scope.cte < doc.ctes.length ? scope.cte : undefined;
  const chain = chainOf(doc, { cte, part: 0 });
  return { cte, part: scope.part <= chain.rest.length ? scope.part : 0 };
}

function updateChain(doc: QueryDoc, cte: number | undefined, fn: (c: SelectChain) => SelectChain): QueryDoc {
  return cte === undefined ? { ...doc, main: fn(doc.main) } : { ...doc, ctes: doc.ctes.map((c, i) => i === cte ? { ...c, query: fn(c.query) } : c) };
}

function updateSelect(chain: SelectChain, part: number, fn: (s: SelectModel) => SelectModel): SelectChain {
  return part === 0 ? { ...chain, first: fn(chain.first) } : { ...chain, rest: chain.rest.map((r, i) => i === part - 1 ? { ...r, select: fn(r.select) } : r) };
}

function message(e: unknown): string {
  return cleanQueryError(e instanceof Error ? e.message : String(e));
}

interface SourceInfo {
  readonly id: string;
  readonly source: Source;
  readonly ref?: string;
  readonly title: string;
  readonly at: { item: number; join?: number };
  readonly groups: PropertyGroup[];
}

const sameExpr = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

/** Diagram edges: joins (anchored on the sources their ON clause mentions) and WHERE equalities that
 * relate two sources. */
function diagramEdges(s: SelectModel, infos: readonly SourceInfo[]): Edge[] {
  const edges: Edge[] = [];
  const idAt = (item: number, join?: number) => infos.find((i) => i.at.item === item && i.at.join === join)!;
  s.from.forEach((f, item) => {
    const prior = [idAt(item)];
    f.joins.forEach((j, ji) => {
      const target = idAt(item, ji);
      let anchors = j.kind === "on" ? prior.filter((p) => p.ref && referencesQualifier(printCond(j.on), p.ref)) : [];
      if (anchors.length === 0) anchors = [prior[prior.length - 1]];
      const label = j.kind === "using" ? `USING ${classLocalName(j.relationship)}` : j.kind === "cross" ? "CROSS"
        : `${j.type}${j.relationship ? ` · ${classLocalName(j.relationship)}` : ""}`;
      for (const a of anchors) edges.push({ id: `j-${a.id}-${target.id}`, source: a.id, target: target.id, label, className: "ig-qb-edge" });
      prior.push(target);
    });
  });
  const top = s.where?.kind === "group" && s.where.op === "AND" ? s.where.items : s.where ? [s.where] : [];
  top.forEach((c, n) => {
    if (c.kind !== "pred" || c.op !== "=") return;
    const a = infos.find((i) => i.ref && referencesQualifier(c.left, i.ref));
    const b = infos.find((i) => i !== a && i.ref && c.args.some((x) => referencesQualifier(x, i.ref!)));
    if (a && b) edges.push({ id: `w-${n}-${a.id}-${b.id}`, source: b.id, target: a.id, label: "WHERE", className: "ig-qb-edge ig-qb-edge--where", style: { strokeDasharray: "5 4" } });
  });
  return edges;
}

type ClassNodeData = { title: string; subtitle: string; ref?: string; columns: string[]; kind: Source["kind"] };
type ClassFlowNode = Node<ClassNodeData, "qbClass">;

function ClassNode({ data, selected }: NodeProps<ClassFlowNode>) {
  return (
    <div className={`ig-qb-node ig-qb-node--${data.kind}${selected ? " ig-qb-node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} title="Drop here to relate the classes" />
      <div className="ig-qb-node__head"><strong>{data.title}</strong>{data.ref && data.ref.toLowerCase() !== data.title.toLowerCase() && <span className="ig-qb-node__alias">{data.ref}</span>}</div>
      <small className="ig-qb-node__sub">{data.subtitle}</small>
      {data.columns.length > 0 && <ul>{data.columns.slice(0, 6).map((c) => <li key={c}>{c}</li>)}
        {data.columns.length > 6 && <li>+{data.columns.length - 6} more</li>}</ul>}
      <Handle type="source" position={Position.Right} title="Drag to another class to relate them" />
    </div>
  );
}
const nodeTypes = { qbClass: ClassNode };
const elk = new ELK();

function FitOnChange({ request }: { request: number }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow<ClassFlowNode>();
  useEffect(() => {
    if (!initialized) return;
    // Two frames: new boxes are measured one frame after their positions are applied.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { void fitView({ padding: 0.25, maxZoom: 1, duration: 0 }); });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, initialized, fitView]);
  return null;
}

interface PickerItem { readonly value: string; readonly label: string; readonly detail?: string }

/** Search box over a long list (classes, CTEs); picks on click or Enter. */
function Picker({ items, label, onPick }: { items: readonly PickerItem[]; label: string; onPick: (value: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const lower = q.trim().toLowerCase();
    return (lower ? items.filter((i) => `${i.value} ${i.label}`.toLowerCase().includes(lower)) : items).slice(0, 40);
  }, [items, q]);
  const pick = (value: string) => {
    onPick(value);
    setQ("");
    setOpen(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  return (
    <div className="ig-qb-picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input aria-label={label} placeholder={`${label} — type to search`} value={q} aria-expanded={open}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          if (e.key === "Enter" && shown[0]) { e.preventDefault(); pick(shown[0].value); }
        }} />
      {open && <ul role="listbox" aria-label={`${label} results`}>
        {shown.map((i) => (
          <li key={i.value} role="option" aria-selected={false} tabIndex={0} onClick={() => pick(i.value)}
            onKeyDown={(e) => { if (e.key === "Enter") pick(i.value); }}>
            <span>{i.label}</span>{i.detail && <small>{i.detail}</small>}
          </li>
        ))}
        {shown.length === 0 && <li className="ig-qb-muted">No matches.</li>}
      </ul>}
    </div>
  );
}

function FieldRows({ fields, qualifier, columns, onToggle, onFilter, onSort, depth = 0 }: {
  fields: readonly PropertyField[]; qualifier?: string; columns: readonly string[]; depth?: number;
  onToggle: (expr: string) => void; onFilter: (expr: string, f: PropertyField) => void; onSort: (expr: string) => void;
}) {
  return <>{fields.map((f) => {
    const expr = propertyRef(qualifier, f.path);
    const checked = columns.some((c) => sameExpr(c, expr));
    const filterable = f.scalar || operatorsFor(f.type).length > 0;
    return (
      <li key={f.path}>
        <div className="ig-qb-field" style={{ paddingLeft: depth * 14 }}>
          <label title={expr}><input type="checkbox" checked={checked} onChange={() => onToggle(expr)} /> {f.label !== f.path.split(".").pop() ? `${f.path.split(".").pop()} (${f.label})` : f.label}</label>
          <small className="ig-qb-type">{f.type}</small>
          <button type="button" className="ig-qb-mini" disabled={!filterable} aria-label={`Filter on ${f.path}`} title="Add a WHERE condition" onClick={() => onFilter(expr, f)}>where</button>
          <button type="button" className="ig-qb-mini" disabled={!f.scalar} aria-label={`Sort by ${f.path}`} title="Add to ORDER BY" onClick={() => onSort(expr)}>sort</button>
        </div>
        {f.members && <ul><FieldRows fields={f.members} qualifier={qualifier} columns={columns} depth={depth + 1} onToggle={onToggle} onFilter={onFilter} onSort={onSort} /></ul>}
      </li>
    );
  })}</>;
}

interface JoinDraft { readonly key: string; otherClass: string; form: JoinForm; type: JoinType }

function suggestionKey(s: JoinSuggestion): string { return `${s.relationship}|${s.direction}`; }

export function QueryBuilderDialog({ port, registry, initialEcsql, loadCounts, onUse, onClose }: QueryBuilderDialogProps) {
  const fieldListId = useId();
  const startBlank = !initialEcsql.trim();
  const [doc, setDoc] = useState<QueryDoc | undefined>(() => startBlank ? newDoc() : undefined);
  const [text, setText] = useState(() => startBlank ? printDoc(newDoc()) : initialEcsql);
  /** Who wrote the current text: pasted/typed text stays authoritative until a visual edit. */
  const origin = useRef<"visual" | "text">(startBlank ? "visual" : "text");
  const [analysis, setAnalysis] = useState<{ text: string; tree?: NativeNode; error?: string }>();
  const [modelError, setModelError] = useState<string>();
  const [scopeState, setScope] = useState<Scope>({ part: 0 });
  const [selectedId, setSelectedId] = useState<string>();
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [fitRequest, setFitRequest] = useState(0);
  const [connecting, setConnecting] = useState<{ anchor: string; other: string }>();
  const [joinDraft, setJoinDraft] = useState<JoinDraft>();
  const [joinSearch, setJoinSearch] = useState("");
  const [propSearch, setPropSearch] = useState("");
  const [clauseTab, setClauseTab] = useState<"columns" | "where" | "group" | "order">("columns");
  const [bottomTab, setBottomTab] = useState<"ecsql" | "tree" | "results">("ecsql");
  const [results, setResults] = useState<{ rows?: Row[]; error?: string; running?: boolean; text?: string }>({});
  const [counts, setCounts] = useState<QueryCounts>();
  const [notice, setNotice] = useState<string>();
  const [newCte, setNewCte] = useState<string>();

  useEffect(() => {
    if (!loadCounts) return;
    let live = true;
    loadCounts().then((c) => { if (live) setCounts(c); }, (e: unknown) => { if (live) setNotice(`Instance counts unavailable: ${message(e)}`); });
    return () => { live = false; };
  }, [loadCounts]);

  useEffect(() => {
    let live = true;
    const current = text;
    const timer = setTimeout(() => {
      analyse(port, current).then((r) => {
        if (!live) return;
        setAnalysis({ text: current, ...r });
        if (r.tree && origin.current === "text") {
          try { setDoc(docFromNative(r.tree)); setModelError(undefined); } catch (e) { setModelError(message(e)); }
        }
      }, (e: unknown) => { if (live) setAnalysis({ text: current, error: message(e) }); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [text, port]);

  const scope = doc ? clampScope(doc, scopeState) : scopeState;
  const chain = doc ? chainOf(doc, scope) : undefined;
  const select = chain ? selectOf(chain, scope.part) : undefined;
  const ctes = useMemo(() => doc?.ctes ?? [], [doc]);

  const infos: SourceInfo[] = useMemo(() => !select ? [] : describeSources(select).map((d) => ({
    ...d, id: `${d.at.item}:${d.at.join ?? "-"}`, groups: sourceFields(registry, d.source, ctes),
  })), [select, registry, ctes]);
  const edges = useMemo(() => select ? diagramEdges(select, infos) : [], [select, infos]);
  const selected = infos.find((i) => i.id === selectedId);

  const lookup: FieldLookup = (expr) => {
    const e = expr.trim().replace(/[[\]]/g, "");
    for (const i of infos)
      if (i.ref && e.toLowerCase().startsWith(`${i.ref.toLowerCase()}.`)) return findField(i.groups, e.slice(i.ref.length + 1));
    for (const i of infos)
      if (!i.ref) { const f = findField(i.groups, e); if (f) return f; }
    return undefined;
  };
  const fieldOptions = useMemo(() => infos.flatMap((i) => i.groups.flatMap((g) => g.fields.flatMap((f) => [f, ...(f.members ?? [])]))
    .map((f) => propertyRef(i.ref, f.path))), [infos]);

  const classItems: PickerItem[] = useMemo(() => classChoices(registry, counts?.classes)
    .map((c) => ({ value: c.className, label: c.className, detail: [c.kind !== "entity" ? c.kind : "", c.abstract ? "abstract" : "", c.count !== undefined ? `${c.count.toLocaleString()} instances` : ""].filter(Boolean).join(" · ") })), [registry, counts]);
  const sourceItems: PickerItem[] = useMemo(() => [
    ...ctes.map((c) => ({ value: `cte:${c.name}`, label: c.name, detail: "common table expression" })),
    ...classItems,
  ], [ctes, classItems]);

  // Layout: re-run ELK whenever the set of boxes or connections changes.
  const layoutKey = `${infos.map((i) => i.id).join(",")}|${edges.map((e) => `${e.source}>${e.target}`).join(",")}|${scope.cte ?? "m"}.${scope.part}`;
  useEffect(() => {
    if (infos.length === 0) return;
    let live = true;
    elk.layout({
      id: "query", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "40", "elk.layered.spacing.nodeNodeBetweenLayers": "150" },
      children: infos.map((i) => ({ id: i.id, width: 210, height: 110 })),
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    }).then((layout) => {
      if (!live) return;
      setPositions(Object.fromEntries((layout.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])));
      setFitRequest((n) => n + 1);
    }, (e: unknown) => { if (live) setNotice(`Layout failed: ${message(e)}`); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey captures the structural inputs.
  }, [layoutKey]);

  const nodes: ClassFlowNode[] = infos.map((i, n) => ({
    id: i.id, type: "qbClass", position: positions[i.id] ?? { x: n * 260, y: 0 }, selected: i.id === selectedId,
    ...(measured[i.id] ? { measured: measured[i.id] } : {}),
    data: {
      title: i.title, ref: i.ref, kind: i.source.kind,
      subtitle: i.source.kind === "class" ? `${i.source.only ? "ONLY " : ""}${i.source.className}` : i.source.kind === "cte" ? "CTE" : i.source.ecsql,
      columns: select!.columns.filter((c) => i.ref ? referencesQualifier(c.expr, i.ref) : infos.length === 1).map((c) => c.alias ?? c.expr),
    },
  }));

  function commit(next: QueryDoc) {
    origin.current = "visual";
    setDoc(next);
    setText(printDoc(next));
    setNotice(undefined);
  }
  function editSelect(fn: (s: SelectModel) => SelectModel) {
    if (!doc) return;
    try { commit(updateChain(doc, scope.cte, (c) => updateSelect(c, scope.part, fn))); } catch (e) { setNotice(message(e)); }
  }
  function editChain(fn: (c: SelectChain) => SelectChain) {
    if (doc) commit(updateChain(doc, scope.cte, fn));
  }

  function addFromPicker(value: string) {
    editSelect((s) => {
      const cte = value.startsWith("cte:") ? value.slice(4) : undefined;
      if (s.from.length === 0) {
        const source: Source = cte ? { kind: "cte", name: cte } : { kind: "class", className: value };
        return { ...s, from: [{ source, joins: [] }], columns: s.columns.length ? s.columns : selectFromClass(value).columns };
      }
      if (!cte) {
        const r = addSource(registry, s, value);
        setSelectedId(`${r.select.from.length - 1}:-`);
        return r.select;
      }
      let next = s;
      if (s.from.length === 1 && s.from[0].joins.length === 0) {
        const src = s.from[0].source;
        next = ensureAlias(s, 0, new Set(sourceFields(registry, src, ctes).flatMap((g) => g.fields.map((f) => f.path.toLowerCase())))).select;
      }
      const used = usedAliases(next);
      const source: Source = used.has(cte.toLowerCase()) ? { kind: "cte", name: cte, alias: makeAlias(cte, used) } : { kind: "cte", name: cte };
      return { ...next, from: [...next.from, { source, joins: [] }] };
    });
  }

  function toggleColumn(expr: string) {
    editSelect((s) => s.columns.some((c) => sameExpr(c.expr, expr))
      ? { ...s, columns: s.columns.filter((c) => !sameExpr(c.expr, expr)) }
      : { ...s, columns: [...s.columns, { expr }] });
  }
  function addFilter(expr: string, f: PropertyField) {
    const op = f.scalar ? operatorsFor(f.type)[0] ?? "=" : "IS NOT NULL";
    editSelect((s) => ({ ...s, where: andCond(s.where, { kind: "pred", left: expr, op, args: [] }) }));
    setClauseTab("where");
  }
  function addSort(expr: string) {
    editSelect((s) => s.orderBy.some((o) => sameExpr(o.expr, expr)) ? s : { ...s, orderBy: [...s.orderBy, { expr }] });
    setClauseTab("order");
  }

  function startJoin(sug: JoinSuggestion) {
    setJoinDraft({ key: suggestionKey(sug), otherClass: sug.otherDefault, form: sug.forms[0], type: "INNER" });
  }
  function doJoin(sug: JoinSuggestion, draft: JoinDraft) {
    if (!selected) return;
    editSelect((s) => {
      const r = applyJoin(registry, s, { anchor: selected.at, suggestion: sug, otherClass: draft.otherClass, form: draft.form, type: draft.type });
      const item = selected.at.item;
      setSelectedId(`${item}:${r.select.from[item].joins.length - 1}`);
      return r.select;
    });
    setJoinDraft(undefined);
    setJoinSearch("");
  }
  function removeSelected() {
    if (!selected) return;
    const { item, join } = selected.at;
    editSelect((s) => join !== undefined ? removeJoin(s, item, join) : removeFromItem(s, item));
    setSelectedId(undefined);
  }
  function renameSelected(to: string) {
    if (!selected?.ref || !to || to === selected.ref) return;
    if (quoteIdentifier(to) !== to) { setNotice(`'${to}' is not a valid alias.`); return; }
    if (select && usedAliases(select).has(to.toLowerCase())) { setNotice(`Alias '${to}' is already used.`); return; }
    editSelect((s) => renameAlias(s, selected.ref!, to));
  }

  const anchorInfo = connecting && infos.find((i) => i.id === connecting.anchor);
  const otherInfo = connecting && infos.find((i) => i.id === connecting.other);
  const connectChoices = anchorInfo?.source.kind === "class" && otherInfo?.source.kind === "class"
    ? connectingSuggestions(registry, anchorInfo.source.className, otherInfo.source.className, counts?.relationships) : [];

  const suggestions = useMemo(() => selected?.source.kind === "class" ? joinSuggestions(registry, selected.source.className, counts?.relationships) : [],
    [selected, registry, counts]);
  const shownSuggestions = suggestions.filter((s) => !joinSearch.trim() || `${s.relationship} ${s.roleLabel} ${s.otherClasses.join(" ")}`.toLowerCase().includes(joinSearch.trim().toLowerCase())).slice(0, 30);

  const checking = analysis?.text !== text;
  const valid = !checking && !!analysis?.tree;
  const mainCols = doc?.main.first.columns ?? [];
  const seedHint = valid && mainCols.length > 0 && !mainCols.some((c) => /ECInstanceId/i.test(c.alias ?? c.expr));

  async function runResults() {
    const current = text;
    setResults({ running: true, text: current });
    setBottomTab("results");
    try { setResults({ rows: await port.query(current, undefined, { limit: 100 }), text: current }); }
    catch (e) { setResults({ error: message(e), text: current }); }
  }

  const columnsPanel = select && (
    <div className="ig-qb-list">
      <label className="ig-qb-inline"><input type="checkbox" checked={select.quantifier === "DISTINCT"}
        onChange={(e) => editSelect((s) => ({ ...s, quantifier: e.target.checked ? "DISTINCT" : undefined }))} /> DISTINCT</label>
      {select.columns.length === 0 && <small className="ig-qb-muted">No columns: the query selects * (all properties).</small>}
      {select.columns.map((c, i) => {
        const agg = /^(\w+)\((.*)\)$/s.exec(c.expr);
        const fn = agg && AGGREGATES.some((a) => a === agg[1].toUpperCase()) ? agg[1].toUpperCase() : "";
        return (
          <div key={i} className="ig-qb-listrow">
            <select aria-label={`Aggregate ${i + 1}`} value={fn} onChange={(e) => {
              const inner = fn && agg ? agg[2] : c.expr;
              editSelect((s) => ({ ...s, columns: s.columns.map((x, j) => j === i ? { ...x, expr: e.target.value ? `${e.target.value}(${inner})` : inner } : x) }));
            }}><option value="">—</option>{AGGREGATES.map((a) => <option key={a}>{a}</option>)}</select>
            <input aria-label={`Column ${i + 1}`} list={fieldListId} value={c.expr}
              onChange={(e) => editSelect((s) => ({ ...s, columns: s.columns.map((x, j) => j === i ? { ...x, expr: e.target.value } : x) }))} />
            <input aria-label={`Alias ${i + 1}`} className="ig-qb-alias" placeholder="alias" value={c.alias ?? ""}
              onChange={(e) => editSelect((s) => ({ ...s, columns: s.columns.map((x, j) => j === i ? { ...x, alias: e.target.value || undefined } : x) }))} />
            <button type="button" className="ig-qb-mini" disabled={i === 0} aria-label={`Move column ${i + 1} up`}
              onClick={() => editSelect((s) => { const cols = [...s.columns]; [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; return { ...s, columns: cols }; })}>↑</button>
            <button type="button" className="ig-qb-x" aria-label={`Remove column ${i + 1}`}
              onClick={() => editSelect((s) => ({ ...s, columns: s.columns.filter((_, j) => j !== i) }))}>×</button>
          </div>
        );
      })}
      <Button size="small" styleType="borderless" onClick={() => editSelect((s) => ({ ...s, columns: [...s.columns, { expr: "" }] }))}>+ Column expression</Button>
    </div>
  );

  const condPanel = (which: "where" | "having") => select && (
    select[which]
      ? <CondEditor cond={select[which]} lookup={lookup} fieldList={fieldListId}
        onChange={(c: Cond) => editSelect((s) => ({ ...s, [which]: c }))}
        onRemove={() => editSelect((s) => ({ ...s, [which]: undefined }))} />
      : <Button size="small" styleType="borderless" onClick={() => editSelect((s) => ({ ...s, [which]: { kind: "group", op: "AND", items: [{ kind: "pred", left: "", op: "=", args: [] }] } }))}>
        + {which === "where" ? "WHERE" : "HAVING"} condition</Button>
  );

  return (
    <Modal isOpen title="ECSQL query builder" onClose={onClose} closeOnExternalClick={false} closeOnEsc={false} className="ig-query-builder">
      <ModalContent>
        <datalist id={fieldListId}>{fieldOptions.map((f) => <option key={f} value={f} />)}</datalist>
        {!doc && (
          <div className="ig-qb-banner" role="status">
            {checking || !analysis ? "Analysing the query…" : <>
              The builder cannot show this query{modelError ? `: ${modelError}` : analysis.error ? `: ${analysis.error}` : "."} Edit the text below, or
              <Button size="small" styleType="borderless" onClick={() => commit(newDoc())}>start a new visual query</Button>
            </>}
          </div>
        )}
        {doc && origin.current === "text" && (
          <div className="ig-qb-banner ig-qb-banner--info" role="status">
            {analysis?.error && !checking ? `The text has an error (${analysis.error}); the builder shows the last valid version.`
              : "The query text is kept as you wrote it until you edit visually; it is then regenerated from the builder (* expands to all columns and schema aliases such as bis resolve to BisCore)."}
          </div>
        )}
        {doc && chain && select && <>
          <div className="ig-qb-scopes" role="tablist" aria-label="Query parts">
            {doc.ctes.map((c, i) => (
              <button key={i} type="button" role="tab" aria-selected={scope.cte === i} className="ig-qb-tab ig-qb-tab--cte"
                onClick={() => { setScope({ cte: i, part: 0 }); setSelectedId(undefined); }}>WITH {c.name}</button>
            ))}
            {newCte === undefined
              ? <button type="button" className="ig-qb-tab ig-qb-tab--add" title="Add a common table expression" onClick={() => setNewCte("")}>+ CTE</button>
              : <span className="ig-qb-inline">
                <input aria-label="New CTE name" autoFocus placeholder="name" value={newCte} onChange={(e) => setNewCte(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setNewCte(undefined);
                    if (e.key !== "Enter") return;
                    const name = newCte.trim();
                    if (quoteIdentifier(name) !== name || doc.ctes.some((c) => c.name.toLowerCase() === name.toLowerCase())) { setNotice(`'${name}' is not a valid, unused CTE name.`); return; }
                    commit({ ...doc, ctes: [...doc.ctes, { name, columns: [], query: { first: selectFromClass(DEFAULT_CLASS), rest: [] } }] });
                    setScope({ cte: doc.ctes.length, part: 0 });
                    setNewCte(undefined);
                  }} /><small>Enter to add</small></span>}
            <button type="button" role="tab" aria-selected={scope.cte === undefined} className="ig-qb-tab"
              onClick={() => { setScope({ part: 0 }); setSelectedId(undefined); }}>Main query</button>
            {doc.ctes.length > 0 && <label className="ig-qb-inline"><input type="checkbox" checked={doc.recursive}
              onChange={(e) => commit({ ...doc, recursive: e.target.checked })} /> RECURSIVE</label>}
          </div>
          {scope.cte !== undefined && (
            <div className="ig-qb-row">
              <label className="ig-qb-inline">CTE columns <input aria-label="CTE columns" placeholder="optional: a, b, c" value={doc.ctes[scope.cte].columns.join(", ")}
                onChange={(e) => commit({ ...doc, ctes: doc.ctes.map((c, i) => i === scope.cte ? { ...c, columns: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } : c) })} /></label>
              <small className="ig-qb-muted">Reference this CTE from another part with “Add source”. A recursive CTE combines an anchor SELECT with UNION ALL and a SELECT from itself.</small>
              <Button size="small" styleType="borderless" onClick={() => {
                const name = doc.ctes[scope.cte!].name;
                commit({ ...doc, ctes: doc.ctes.filter((_, i) => i !== scope.cte), recursive: doc.ctes.length > 1 && doc.recursive });
                setScope({ part: 0 });
                setNotice(`Removed CTE ${name}; parts that referenced it now fail until updated.`);
              }}>Delete CTE</Button>
            </div>
          )}
          <div className="ig-qb-row" role="tablist" aria-label="Compound parts">
            {[chain.first, ...chain.rest.map((r) => r.select)].map((_, p) => (
              <span key={p} className="ig-qb-inline">
                {p > 0 && <select aria-label={`Combine part ${p + 1}`} value={chain.rest[p - 1].op}
                  onChange={(e) => editChain((c) => ({ ...c, rest: c.rest.map((r, i) => i === p - 1 ? { ...r, op: e.target.value as CompoundOp } : r) }))}>
                  {COMPOUND_OPS.map((o) => <option key={o}>{o}</option>)}</select>}
                <button type="button" role="tab" aria-selected={scope.part === p} className="ig-qb-tab"
                  onClick={() => { setScope({ cte: scope.cte, part: p }); setSelectedId(undefined); }}>SELECT {p + 1}</button>
                {p > 0 && scope.part === p && <button type="button" className="ig-qb-x" aria-label={`Remove part ${p + 1}`}
                  onClick={() => { editChain((c) => ({ ...c, rest: c.rest.filter((_, i) => i !== p - 1) })); setScope({ cte: scope.cte, part: 0 }); }}>×</button>}
              </span>
            ))}
            <Button size="small" styleType="borderless" title="Combine with another SELECT (UNION, INTERSECT, EXCEPT)" onClick={() => {
              const base = chain.first.from[0]?.source;
              const seed = selectFromClass(base?.kind === "class" ? base.className : DEFAULT_CLASS);
              editChain((c) => ({ ...c, rest: [...c.rest, { op: "UNION ALL", select: { ...seed, columns: c.first.columns.length === seed.columns.length ? seed.columns : c.first.columns.map((col) => ({ expr: col.expr })) } }] }));
              setScope({ cte: scope.cte, part: chain.rest.length + 1 });
            }}>+ UNION…</Button>
          </div>
          <div className="ig-qb-workspace">
            <div className="ig-qb-canvaswrap">
              <div className="ig-qb-canvas">
                <ReactFlowProvider>
                  <ReactFlow<ClassFlowNode>
                    nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2} connectOnClick connectionRadius={30}
                    nodesConnectable elementsSelectable deleteKeyCode={null}
                    onNodeClick={(_e, n) => { setSelectedId(n.id); setJoinDraft(undefined); setConnecting(undefined); }}
                    onPaneClick={() => setSelectedId(undefined)}
                    onNodesChange={(changes) => {
                      // Nodes are derived from the query each render, so keep React Flow's measurements and drags here.
                      setPositions((p) => {
                        let next = p;
                        for (const c of changes) if (c.type === "position" && c.position) next = { ...next, [c.id]: c.position };
                        return next;
                      });
                      setMeasured((m) => {
                        let next = m;
                        for (const c of changes) if (c.type === "dimensions" && c.dimensions) next = { ...next, [c.id]: c.dimensions };
                        return next;
                      });
                    }}
                    onConnect={(c) => {
                      if (c.source === c.target) return;
                      setConnecting({ anchor: c.source, other: c.target });
                      setSelectedId(undefined);
                    }}
                  ><FitOnChange request={fitRequest} /><Background /><Controls showInteractive={false} /></ReactFlow>
                </ReactFlowProvider>
              </div>
              <div className="ig-qb-addsource">
                <Picker label={select.from.length ? "Add source" : "Choose a class"} items={sourceItems} onPick={addFromPicker} />
              </div>
            </div>
            <aside className="ig-qb-side" aria-label="Source details">
              {connecting && anchorInfo && otherInfo ? <>
                <h3>Relate {anchorInfo.ref ?? anchorInfo.title} → {otherInfo.ref ?? otherInfo.title}</h3>
                {!anchorInfo.ref || !otherInfo.ref ? <p>Both sources need an alias to be related.</p>
                  : connectChoices.length === 0 ? <p>No relationship connects {anchorInfo.title} and {otherInfo.title}. Add a WHERE condition by hand instead.</p>
                    : <ul className="ig-qb-sugs">{connectChoices.map((s) => (
                      <li key={suggestionKey(s)}><button type="button" onClick={() => {
                        editSelect((sel) => connectSources(sel, anchorInfo.ref!, otherInfo.ref!, s));
                        setConnecting(undefined);
                      }}><strong>{classLocalName(s.relationship)}</strong> <small>{s.roleLabel}{s.count !== undefined ? ` · ${s.count.toLocaleString()}` : ""}</small></button></li>
                    ))}</ul>}
                <small className="ig-qb-muted">Adds the relationship as WHERE conditions (navigation properties) or a join through the relationship class.</small>
                <Button size="small" onClick={() => setConnecting(undefined)}>Cancel</Button>
              </> : selected ? <>
                <h3>{selected.title}</h3>
                <small className="ig-qb-muted">{selected.source.kind === "class" ? selected.source.className : selected.source.kind === "cte" ? "Common table expression" : "Subquery (edit as text)"}</small>
                {selected.ref && <label className="ig-qb-inline">Alias <input key={selected.ref} aria-label="Alias" defaultValue={selected.ref}
                  onBlur={(e) => renameSelected(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") renameSelected(e.currentTarget.value.trim()); }} /></label>}
                {selected.source.kind === "class" && <label className="ig-qb-inline"><input type="checkbox" checked={!!selected.source.only}
                  onChange={(e) => editSelect((s) => {
                    const at = selected.at;
                    const flip = (src: Source): Source => src.kind === "class" ? { ...src, only: e.target.checked || undefined } : src;
                    return { ...s, from: s.from.map((f, i) => i !== at.item ? f : at.join === undefined ? { ...f, source: flip(f.source) } : { ...f, joins: f.joins.map((j, k) => k === at.join ? { ...j, source: flip(j.source) } : j) }) };
                  })} /> ONLY (exclude subclasses)</label>}
                <Button size="small" styleType="borderless" disabled={select.from.length === 1 && selected.at.join === undefined} onClick={removeSelected}>Remove source</Button>
                {selected.source.kind === "class" && <section>
                  <h4>Join a related class</h4>
                  <input aria-label="Search relationships" placeholder="Search relationships" value={joinSearch} onChange={(e) => setJoinSearch(e.target.value)} />
                  <ul className="ig-qb-sugs">{shownSuggestions.map((s) => {
                    const key = suggestionKey(s);
                    const draft = joinDraft?.key === key ? joinDraft : undefined;
                    return (
                      <li key={key}>
                        <button type="button" aria-expanded={!!draft} onClick={() => draft ? setJoinDraft(undefined) : startJoin(s)}>
                          <strong>{s.roleLabel}</strong> <small>{classLocalName(s.relationship)} · {s.otherMultiplicity}{s.count !== undefined ? ` · ${s.count.toLocaleString()} links` : ""}{s.navigation ? " · nav" : ""}</small>
                        </button>
                        {draft && <div className="ig-qb-joinform">
                          <label>Class<select value={draft.otherClass} onChange={(e) => setJoinDraft({ ...draft, otherClass: e.target.value })}>
                            {s.otherClasses.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                          <label>Join via<select value={draft.form} onChange={(e) => setJoinDraft({ ...draft, form: e.target.value as JoinForm })}>
                            {s.forms.map((f) => <option key={f} value={f}>{FORM_LABEL[f]}</option>)}</select></label>
                          {draft.form !== "using" && <label>Type<select value={draft.type} onChange={(e) => setJoinDraft({ ...draft, type: e.target.value as JoinType })}>
                            {JOIN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>}
                          <Button size="small" styleType="high-visibility" onClick={() => doJoin(s, draft)}>Join</Button>
                        </div>}
                      </li>
                    );
                  })}
                  {shownSuggestions.length === 0 && <li className="ig-qb-muted">No relationships.</li>}</ul>
                </section>}
                <section>
                  <h4>Properties</h4>
                  <input aria-label="Search properties" placeholder="Search properties" value={propSearch} onChange={(e) => setPropSearch(e.target.value)} />
                  {selected.groups.map((g) => {
                    const q = propSearch.trim().toLowerCase();
                    const fields = q ? g.fields.filter((f) => `${f.path} ${f.label}`.toLowerCase().includes(q)) : g.fields;
                    return fields.length === 0 ? null : (
                      <details key={g.title} open={g.title === "System" || g.title.endsWith("(own)") || !!q || selected.groups.length <= 3}>
                        <summary>{g.title} <small>({fields.length})</small></summary>
                        <ul className="ig-qb-fields"><FieldRows fields={fields} qualifier={selected.ref} columns={select.columns.map((c) => c.expr)}
                          onToggle={toggleColumn} onFilter={addFilter} onSort={addSort} /></ul>
                      </details>
                    );
                  })}
                </section>
              </> : <>
                <h3>Build your query</h3>
                <ul className="ig-qb-tips">
                  <li>Select a class box to pick columns, add filters and join related classes.</li>
                  <li>Drag from one box’s right handle to another box to relate two sources.</li>
                  <li>Use “Add source” for an unrelated class or a CTE, “+ CTE” for a WITH block and “+ UNION…” to combine SELECTs.</li>
                  <li>Paste any SELECT into the ECSQL tab to edit it visually.</li>
                </ul>
              </>}
            </aside>
          </div>
          <div className="ig-qb-clauses">
            <div role="tablist" aria-label="Clauses" className="ig-qb-row">
              {([["columns", `Columns (${select.columns.length})`], ["where", "Where"], ["group", "Group / Having"], ["order", "Order / Limit"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={clauseTab === k} className="ig-qb-tab" onClick={() => setClauseTab(k)}>{l}</button>
              ))}
            </div>
            <div className="ig-qb-clause" role="tabpanel">
              {clauseTab === "columns" && columnsPanel}
              {clauseTab === "where" && condPanel("where")}
              {clauseTab === "group" && <>
                <h4>GROUP BY</h4>
                <ListEditor label="Group term" items={select.groupBy} fieldList={fieldListId} onChange={(groupBy) => editSelect((s) => ({ ...s, groupBy }))} />
                <h4>HAVING</h4>
                {condPanel("having")}
              </>}
              {clauseTab === "order" && <>
                <h4>ORDER BY</h4>
                <ListEditor label="Sort term" items={select.orderBy.map((o) => o.expr)} fieldList={fieldListId}
                  onChange={(items) => editSelect((s) => ({ ...s, orderBy: items.map((expr, i) => ({ expr, dir: items.length === s.orderBy.length ? s.orderBy[i]?.dir : s.orderBy.find((o) => o.expr === expr)?.dir })) }))}
                  render={(i) => <select aria-label={`Direction ${i + 1}`} value={select.orderBy[i]?.dir ?? ""}
                    onChange={(e) => editSelect((s) => ({ ...s, orderBy: s.orderBy.map((o, j) => j === i ? { ...o, dir: e.target.value === "DESC" ? "DESC" : e.target.value === "ASC" ? "ASC" : undefined } : o) }))}>
                    <option value="">default</option><option value="ASC">ASC</option><option value="DESC">DESC</option></select>} />
                <div className="ig-qb-row">
                  <label className="ig-qb-inline">LIMIT <input aria-label="Limit" className="ig-qb-num" value={select.limit ?? ""} onChange={(e) => editSelect((s) => ({ ...s, limit: e.target.value || undefined }))} /></label>
                  <label className="ig-qb-inline">OFFSET <input aria-label="Offset" className="ig-qb-num" disabled={!select.limit} value={select.offset ?? ""} onChange={(e) => editSelect((s) => ({ ...s, offset: e.target.value || undefined }))} /></label>
                </div>
              </>}
            </div>
          </div>
        </>}
        <div className="ig-qb-bottom">
          <div role="tablist" aria-label="Output" className="ig-qb-row">
            <button type="button" role="tab" aria-selected={bottomTab === "ecsql"} className="ig-qb-tab" onClick={() => setBottomTab("ecsql")}>ECSQL</button>
            <button type="button" role="tab" aria-selected={bottomTab === "tree"} className="ig-qb-tab" onClick={() => setBottomTab("tree")}>Parse tree</button>
            <button type="button" role="tab" aria-selected={bottomTab === "results"} className="ig-qb-tab" onClick={() => setBottomTab("results")}>Results</button>
            <span className={`ig-qb-badge ig-qb-badge--${checking ? "pending" : valid ? "ok" : "bad"}`} role="status">
              {checking ? "Checking…" : valid ? "Valid ECSQL" : `Invalid: ${analysis?.error ?? "unknown error"}`}
            </span>
          </div>
          {bottomTab === "ecsql" && <div className="ig-qb-sqlpane">
            <textarea aria-label="ECSQL text" rows={8} spellCheck={false} value={text} onChange={(e) => { origin.current = "text"; setText(e.target.value); }} />
            <div className="ig-qb-row">
              <Button size="small" disabled={!doc || origin.current === "visual"} title="Replace the text with the builder’s version"
                onClick={() => doc && commit(doc)}>Regenerate from builder</Button>
              <Button size="small" disabled={!text.trim() || results.running} onClick={() => void runResults()}>Preview results</Button>
            </div>
          </div>}
          {bottomTab === "tree" && <ParseTreeView tree={!checking ? analysis?.tree : undefined} />}
          {bottomTab === "results" && <div>
            <Button size="small" disabled={!text.trim() || results.running} onClick={() => void runResults()}>{results.running ? "Running…" : results.text === text ? "Refresh" : "Run preview"}</Button>
            {results.text !== undefined && results.text !== text && !results.running && <small className="ig-qb-muted"> Results are for an earlier version of the query.</small>}
            {results.error && <p className="ig-qb-error" role="alert">{results.error}</p>}
            {results.rows && <ResultsTable rows={results.rows} />}
          </div>}
        </div>
        {notice && <p className="ig-qb-notice" role="status">{notice}</p>}
        {seedHint && <p className="ig-qb-notice">Seed queries need an ECInstanceId column (and ideally ECClassId) in the main SELECT.</p>}
      </ModalContent>
      <ModalButtonBar>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!text.trim()} onClick={() => onUse(text, false)}>Use query</Button>
        <Button styleType="high-visibility" disabled={!text.trim()} onClick={() => onUse(text, true)}>Use &amp; run</Button>
      </ModalButtonBar>
    </Modal>
  );
}
