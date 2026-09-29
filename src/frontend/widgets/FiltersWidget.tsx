import { Checkbox, ExpandableBlock, Input, Select, Text, ToggleSwitch } from "@itwin/itwinui-react";
import { useMemo, useState } from "react";
import { type ClassFilterEntry, cycleFilterState, type FilterSpec, type FilterState, isFilterEmpty, EMPTY_FILTERS } from "../engine/filters";
import { graphActions, useGraphStore } from "../state/graphStore";
import "./widgets.css";

export function TriState({ state, onChange, title }: { state: FilterState | undefined; onChange: (s: FilterState | undefined) => void; title?: string }) {
  const label = state === "include" ? "✓" : state === "exclude" ? "✕" : "·";
  return (
    <button className={`ig-tri ig-tri--${state ?? "none"}`} title={`${title ?? ""} ${state ?? "neutral"} — click to cycle include / exclude / neutral`}
      onClick={() => onChange(cycleFilterState(state))}>{label}</button>
  );
}

function setIn<T>(record: Readonly<Record<string, T>>, key: string, value: T | undefined): Record<string, T> {
  const out = { ...record };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

function updateFilters(patch: (f: FilterSpec) => FilterSpec) {
  graphActions.setOptions({ filters: patch(useGraphStore.getState().options.filters) });
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0);
  return (
    <ExpandableBlock title={`${title}${countLabel(count)}`} size="small" isExpanded={open} onToggle={setOpen}>
      {children}
    </ExpandableBlock>
  );
}

function countLabel(n: number) {
  return n > 0 ? ` (${n})` : "";
}

/** Class or relationship filter editor: search to add, then toggle state and polymorphism. */
function ClassFilterSection({ title, names, entries, onChange }: {
  title: string;
  names: readonly string[];
  entries: Readonly<Record<string, ClassFilterEntry>>;
  onChange: (next: Record<string, ClassFilterEntry>) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return names.filter((n) => n.toLowerCase().includes(q) && !entries[n]).slice(0, 30);
  }, [search, names, entries]);

  return (
    <Section title={title} count={Object.keys(entries).length}>
      <Input size="small" placeholder="Search classes to add…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {matches.length > 0 && (
        <div className="ig-list ig-list--short">
          {matches.map((n) => (
            <div key={n} className="ig-filter-row">
              <span className="ig-filter-row__name" title={n}>{n}</span>
              <button className="ig-chip ig-chip--include" onClick={() => { onChange(setIn(entries, n, { state: "include", polymorphic: true })); setSearch(""); }}>Include</button>
              <button className="ig-chip ig-chip--exclude" onClick={() => { onChange(setIn(entries, n, { state: "exclude", polymorphic: true })); setSearch(""); }}>Exclude</button>
            </div>
          ))}
        </div>
      )}
      {Object.entries(entries).map(([name, e]) => (
        <div key={name} className="ig-filter-row">
          <TriState state={e.state} title={name} onChange={(s) => onChange(setIn(entries, name, s ? { ...e, state: s } : undefined))} />
          <span className="ig-filter-row__name" title={name}>{name}</span>
          <Checkbox label="+ subclasses" checked={e.polymorphic} onChange={(ev) => onChange(setIn(entries, name, { ...e, polymorphic: ev.target.checked }))} />
          <button className="ig-x" title="Remove" onClick={() => onChange(setIn(entries, name, undefined))}>×</button>
        </div>
      ))}
    </Section>
  );
}

function StateList({ title, items, states, onChange, searchable }: {
  title: string;
  items: ReadonlyArray<{ key: string; label: string; detail?: string }>;
  states: Readonly<Record<string, FilterState>>;
  onChange: (next: Record<string, FilterState>) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const visible = items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.detail?.toLowerCase().includes(q));
  return (
    <Section title={title} count={Object.keys(states).length}>
      {searchable && items.length > 8 && <Input size="small" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />}
      <div className="ig-list ig-list--short">
        {visible.map((i) => (
          <div key={i.key} className="ig-filter-row">
            <TriState state={states[i.key]} title={i.label} onChange={(s) => onChange(setIn(states, i.key, s))} />
            <span className="ig-filter-row__name" title={i.detail ?? i.label}>{i.label}</span>
            {i.detail && <span className="ig-filter-row__detail">{i.detail}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function FiltersWidget() {
  const engine = useGraphStore((s) => s.engine);
  const models = useGraphStore((s) => s.models);
  const options = useGraphStore((s) => s.options);
  const f = options.filters;

  const { classNames, relNames, schemas } = useMemo(() => {
    if (!engine) return { classNames: [], relNames: [], schemas: [] };
    const all = engine.registry.allClassNames();
    const rel: string[] = [];
    const cls: string[] = [];
    for (const n of all) (engine.registry.findClass(n)?.isRelationship() ? rel : cls).push(n);
    const sch = [...new Set(all.map((n) => n.split(":")[0]))].sort();
    return { classNames: cls, relNames: rel, schemas: sch };
  }, [engine]);

  if (!engine) return <div className="ig-widget"><Text isMuted>Open an iModel first.</Text></div>;

  return (
    <div className="ig-widget">
      <div className="ig-grid2">
        <label>Depth</label>
        <Select<number> size="small" value={options.depth} options={[1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: String(d) }))}
          onChange={(d) => graphActions.setOptions({ depth: d })} />
        <label>Direction</label>
        <Select size="small" value={options.direction}
          options={[{ value: "both", label: "In & out" }, { value: "forward", label: "Outgoing (as source)" }, { value: "backward", label: "Incoming (as target)" }]}
          onChange={(d) => graphActions.setOptions({ direction: d as typeof options.direction })} />
        <label title="Show at most this many neighbours per relationship before summarising as +N">Group cap</label>
        <Input size="small" type="number" min={1} value={options.groupCap}
          onChange={(e) => { const v = Number(e.target.value); if (v > 0) graphActions.setOptions({ groupCap: v }); }} />
        <label title="Stop loading once this many instances are shown">Node budget</label>
        <Input size="small" type="number" min={10} step={50} value={options.nodeBudget}
          onChange={(e) => { const v = Number(e.target.value); if (v >= 10) graphActions.setOptions({ nodeBudget: v }); }} />
        <label title="ECVLib.Relations() is the new experimental ECSQL function; the fallback walks schema metadata">Traversal</label>
        <ToggleSwitch label="Use Relations()" checked={engine.strategy.name === "relations"}
          onChange={(e) => void graphActions.switchStrategy(e.target.checked ? "relations" : "fallback")} />
      </div>

      <div className="ig-row ig-row--between">
        <Text variant="leading">Filters</Text>
        {!isFilterEmpty(f) && <button className="ig-link" onClick={() => graphActions.setOptions({ filters: EMPTY_FILTERS })}>Clear all</button>}
      </div>
      <Text variant="small" isMuted>✓ include only · ✕ exclude · the centre is never hidden.</Text>

      <StateList title="Models" searchable
        items={models.map((m) => ({ key: m.id, label: m.name, detail: m.className.split(":")[1] }))}
        states={f.models} onChange={(models) => updateFilters((x) => ({ ...x, models }))} />
      <StateList title="Schemas" searchable
        items={schemas.map((s) => ({ key: s, label: s }))}
        states={f.schemas} onChange={(schemas) => updateFilters((x) => ({ ...x, schemas }))} />
      <ClassFilterSection title="Classes" names={classNames} entries={f.classes}
        onChange={(classes) => updateFilters((x) => ({ ...x, classes }))} />
      <ClassFilterSection title="Relationships" names={relNames} entries={f.relationships}
        onChange={(relationships) => updateFilters((x) => ({ ...x, relationships }))} />
    </div>
  );
}

export const filterEdits = {
  excludeClass(className: string) {
    updateFilters((x) => ({ ...x, classes: setIn(x.classes, className, { state: "exclude", polymorphic: false }) }));
  },
  excludeModel(modelId: string) {
    updateFilters((x) => ({ ...x, models: setIn(x.models, modelId, "exclude") }));
  },
  excludeRelationship(relClassName: string) {
    updateFilters((x) => ({ ...x, relationships: setIn(x.relationships, relClassName, { state: "exclude", polymorphic: false }) }));
  },
};
