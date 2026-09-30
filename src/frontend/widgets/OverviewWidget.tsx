import { ExpandableBlock, ProgressRadial, Text } from "@itwin/itwinui-react";
import { useEffect, useMemo, useState } from "react";
import { type Census, type ClassCensusEntry, type ModelCensusEntry } from "../engine/census";
import { type ClassFilterEntry, type FilterState } from "../engine/filters";import type { GraphEngine } from "../engine/GraphEngine";
import { buildModelTree, type ModelTreeNode } from "../engine/models";
import { censusFor, modelCensusFor, modelTotalsFor, requestSeedQuery } from "../state/censusStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import { showSchemaFor } from "./SchemaWidget";
import { TriState } from "./FiltersWidget";
import "./widgets.css";

const fmt = (n: number) => n.toLocaleString();

function seedEcsql(className: string, modelId?: string): string {
  const cls = className.replace(":", ".");
  const where = modelId ? ` WHERE Model.Id = ${modelId}` : "";
  return `SELECT ECInstanceId, ECClassId FROM ONLY ${cls}${where} LIMIT 100`;
}

function Bar({ value, max }: { value: number; max: number }) {
  return <span className="ig-bar"><span className="ig-bar__fill" style={{ width: `${Math.max(2, Math.round(100 * value / Math.max(1, max)))}%` }} /></span>;
}

function setClassFilter(className: string, state: FilterState | undefined) {
  const filters = useGraphStore.getState().options.filters;
  const classes: Record<string, ClassFilterEntry> = { ...filters.classes };
  if (state === undefined) delete classes[className];
  else classes[className] = { state, polymorphic: false };
  graphActions.setOptions({ filters: { ...filters, classes } });
}

function ClassRow({ e, max }: { e: ClassCensusEntry; max: number }) {
  // Subscribe so the tri-state repaints when filters change elsewhere.
  const state = useGraphStore((s) => s.options.filters.classes[e.className]?.state);
  const [schema, name] = e.className.split(":");
  return (
    <div className="ig-filter-row ig-census-row">
      <TriState state={state} onChange={(s) => setClassFilter(e.className, s)} title={e.className} />
      <button className="ig-census-row__name ig-link" title={`${e.className} — list instances in the Seed query panel`}
        onClick={() => requestSeedQuery(seedEcsql(e.className))}>
        {name}
      </button>
      <button className="ig-link ig-census-row__schema" title={`Open ${e.className} in the Schema panel`} onClick={() => showSchemaFor(e.className)}>{schema}</button>
      {e.kind !== "element" && <span className="ig-chip ig-chip--kind">{e.kind}</span>}
      <Bar value={e.count} max={max} />
      <span className="ig-census-row__count">{fmt(e.count)}</span>
    </div>
  );
}

function SchemasSection({ census }: { census: Census }) {
  const [open, setOpen] = useState<string>();
  const max = Math.max(...census.schemas.map((s) => s.instances), 1);
  return (
    <>
      {census.schemas.map((s) => (
        <div key={s.schemaName}>
          <div className="ig-filter-row ig-census-row">
            <button className="ig-tree-row__twist" onClick={() => setOpen(open === s.schemaName ? undefined : s.schemaName)}
              aria-label={open === s.schemaName ? "Collapse" : "Expand"}>{open === s.schemaName ? "▾" : "▸"}</button>
            <span className="ig-census-row__name" title={s.schemaName}>{s.schemaName}</span>
            <span className="ig-filter-row__detail" title="Instantiated classes of the classes the schema defines">{s.classesUsed} of {s.classesDefined} classes</span>
            <Bar value={s.instances} max={max} />
            <span className="ig-census-row__count">{fmt(s.instances)}</span>
          </div>
          {open === s.schemaName && (
            <div className="ig-census-nest">
              {census.entries.filter((e) => e.schemaName === s.schemaName).map((e) => (
                <ClassRow key={`${e.kind}:${e.classId}`} e={e} max={max} />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function ClassesSection({ census }: { census: Census }) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? census.entries.filter((e) => e.className.toLowerCase().includes(q)) : census.entries;
  }, [census, search]);
  const max = Math.max(...census.entries.map((e) => e.count), 1);
  return (
    <>
      <input className="ig-filter-input" placeholder="Filter classes" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="ig-list ig-list--short ig-list--tall">
        {shown.map((e) => <ClassRow key={`${e.kind}:${e.classId}`} e={e} max={max} />)}
      </div>
    </>
  );
}

function ModelBreakdown({ engine, modelId }: { engine: GraphEngine; modelId: string }) {
  const [rows, setRows] = useState<ModelCensusEntry[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    modelCensusFor(engine, modelId).then((r) => { if (live) setRows(r); }, (e) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [engine, modelId]);
  if (error) return <div className="ig-error">{error}</div>;
  if (!rows) return <Text variant="small" isMuted>Counting…</Text>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="ig-census-nest">
      {rows.map((r) => (
        <div key={r.classId} className="ig-filter-row ig-census-row">
          <button className="ig-census-row__name ig-link" title={`${r.className} in this model — list instances`}
            onClick={() => requestSeedQuery(seedEcsql(r.className, r.modelId))}>{r.className}</button>
          <Bar value={r.count} max={max} />
          <span className="ig-census-row__count">{fmt(r.count)}</span>
        </div>
      ))}
      {rows.length === 0 && <Text variant="small" isMuted>No elements.</Text>}
    </div>
  );
}

function ModelRows({ engine, node, totals, depth }: { engine: GraphEngine; node: ModelTreeNode; totals: Map<string, number>; depth: number }) {
  const [open, setOpen] = useState(false);
  const m = node.model;
  const count = totals.get(m.id) ?? 0;
  return (
    <>
      <div className="ig-filter-row ig-census-row" style={{ paddingLeft: depth * 14 }}>
        <button className="ig-tree-row__twist" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>{open ? "▾" : "▸"}</button>
        <span className="ig-census-row__name" title={`${m.className} ${m.id}`}>{m.name}</span>
        <span className="ig-census-row__count">{fmt(count)}</span>
      </div>
      {open && (
        <div style={{ paddingLeft: depth * 14 + 14 }}>
          <ModelBreakdown engine={engine} modelId={m.id} />
          {node.children.map((c) => <ModelRows key={c.model.id} engine={engine} node={c} totals={totals} depth={0} />)}
        </div>
      )}
      {!open && node.children.map((c) => <ModelRows key={c.model.id} engine={engine} node={c} totals={totals} depth={depth + 1} />)}
    </>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <ExpandableBlock title={title} size="small" isExpanded={open} onToggle={setOpen}>{children}</ExpandableBlock>;
}

/** What the authoring app actually put in the iModel: instances per schema, class and model. */
export function OverviewWidget() {
  const engine = useGraphStore((s) => s.engine);
  const [census, setCensus] = useState<Census>();
  const [totals, setTotals] = useState<Map<string, number>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setCensus(undefined);
    setTotals(undefined);
    setError(undefined);
    if (!engine) return;
    let live = true;
    censusFor(engine).then((c) => { if (live) setCensus(c); }, (e) => { if (live) setError(String(e?.message ?? e)); });
    modelTotalsFor(engine).then((t) => { if (live) setTotals(t); }, () => { });
    return () => { live = false; };
  }, [engine]);

  if (!engine) return <div className="ig-widget"><Text isMuted>Open an iModel first.</Text></div>;
  if (error) return <div className="ig-widget"><div className="ig-error">{error}</div></div>;
  if (!census) return <div className="ig-widget"><ProgressRadial size="small" indeterminate /> <Text variant="small" isMuted>Counting instances…</Text></div>;

  const tree = buildModelTree(engine.models);
  return (
    <div className="ig-widget">
      <Text variant="small" isMuted>
        {fmt(census.totalInstances)} instances of {census.entries.length} classes from {census.schemas.length} schemas.
        Click a class to list instances; ✓/✕ filters the traversal.
      </Text>
      <Section title="Schemas" defaultOpen>
        <SchemasSection census={census} />
      </Section>
      <Section title="Classes">
        <ClassesSection census={census} />
      </Section>
      <Section title="Models">
        {totals
          ? tree.map((n) => <ModelRows key={n.model.id} engine={engine} node={n} totals={totals} depth={0} />)
          : <Text variant="small" isMuted>Counting…</Text>}
      </Section>
    </div>
  );
}
