import { SvgRedo, SvgUndo } from "@itwin/itwinui-icons-react";
import { Checkbox, ExpandableBlock, IconButton, Input, Select, Text, ToggleSwitch } from "@itwin/itwinui-react";
import { formatShortcut, runCommand } from "../commands/registry";
import { useMemo, useState } from "react";
import { type ClassFilterEntry, cycleFilterState, type FilterSpec, type FilterState, isFilterEmpty } from "../engine/filters";
import { buildModelTree, type ModelInfo, type ModelTreeNode } from "../engine/models";
import { graphActions, useGraphStore } from "../state/graphStore";
import "./widgets.css";

export function TriState({ state, onChange, title, inherited }: {
  state: FilterState | undefined;
  onChange: (s: FilterState | undefined) => void;
  title?: string;
  /** State inherited from a parent, shown faintly when this entry has none of its own. */
  inherited?: FilterState;
}) {
  const shown = state ?? inherited;
  const label = shown === "include" ? "✓" : shown === "exclude" ? "✕" : "·";
  const cls = state ? `ig-tri--${state}` : inherited ? `ig-tri--inherited ig-tri--inherited-${inherited}` : "ig-tri--none";
  const hint = state ?? (inherited ? `${inherited} (inherited from parent model)` : "neutral");
  return (
    <button className={`ig-tri ${cls}`} title={`${title ?? ""} ${hint} — click to cycle include / exclude / neutral`}
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

const modelDetail = (m: ModelInfo) => m.className.split(":")[1];

/** Models nested under their parent models. A model without its own state inherits its nearest
 * ancestor's, matching how the traversal evaluates the filter. */
function ModelTreeList({ models, states, onChange }: {
  models: readonly ModelInfo[];
  states: Readonly<Record<string, FilterState>>;
  onChange: (next: Record<string, FilterState>) => void;
}) {
  const roots = useMemo(() => buildModelTree(models), [models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  // Roots start open so their direct sub-models are visible; everything else starts collapsed.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const isOpen = (n: ModelTreeNode, depth: number) => (depth === 0) !== toggled.has(n.model.id);
  const toggle = (id: string) => setToggled((t) => { const x = new Set(t); if (!x.delete(id)) x.add(id); return x; });
  const set = (id: string, s: FilterState | undefined) => onChange(setIn(states, id, s));

  const q = search.trim().toLowerCase();
  const pathOf = (m: ModelInfo) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let p = m.parentId; p && !seen.has(p); p = byId.get(p)?.parentId) { seen.add(p); names.unshift(byId.get(p)?.name ?? p); }
    return names.join(" › ");
  };
  const inheritedOf = (m: ModelInfo): FilterState | undefined => {
    const seen = new Set<string>();
    for (let p = m.parentId; p && !seen.has(p); p = byId.get(p)?.parentId) { seen.add(p); if (states[p]) return states[p]; }
    return undefined;
  };

  const row = (m: ModelInfo, inherited: FilterState | undefined, depth: number, node?: ModelTreeNode, path?: string) => (
    <div key={m.id} className="ig-filter-row ig-tree-row" style={{ paddingLeft: depth * 14 }}>
      {node && node.children.length > 0
        ? <button className="ig-tree-row__twist" onClick={() => toggle(m.id)} aria-label={isOpen(node, depth) ? "Collapse" : "Expand"}>{isOpen(node, depth) ? "▾" : "▸"}</button>
        : <span className="ig-tree-row__twist" />}
      <TriState state={states[m.id]} inherited={inherited} title={m.name} onChange={(s) => set(m.id, s)} />
      <span className="ig-filter-row__name" title={`${path ? `${path} › ` : ""}${m.name}\n${m.className} ${m.id}`}>{m.name}</span>
      {node && node.children.length > 0 && <span className="ig-filter-row__detail" title="Sub-models">{node.children.length}</span>}
      <span className="ig-filter-row__detail">{path ?? modelDetail(m)}</span>
    </div>
  );

  const renderNode = (n: ModelTreeNode, depth: number, inherited: FilterState | undefined): React.ReactNode[] => {
    const own = states[n.model.id];
    const out: React.ReactNode[] = [row(n.model, inherited, depth, n)];
    if (isOpen(n, depth))
      for (const c of n.children) out.push(...renderNode(c, depth + 1, own ?? inherited));
    return out;
  };

  return (
    <Section title="Models" count={Object.keys(states).length}>
      {models.length > 8 && <Input size="small" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />}
      <div className="ig-list ig-list--short ig-list--tall">
        {q
          ? models.filter((m) => m.name.toLowerCase().includes(q) || m.className.toLowerCase().includes(q))
            .map((m) => row(m, inheritedOf(m), 0, undefined, pathOf(m)))
          : roots.flatMap((r) => renderNode(r, 0, undefined))}
      </div>
    </Section>
  );
}

export const FILTERS_WIDGET_ID = "ig-filters";

export function FiltersWidget() {
  const engine = useGraphStore((s) => s.engine);
  const models = useGraphStore((s) => s.models);
  const options = useGraphStore((s) => s.options);
  const f = options.filters;
  const excluded = options.excludedInstances ?? [];
  const canUndo = useGraphStore((s) => s.canUndoFilters);
  const canRedo = useGraphStore((s) => s.canRedoFilters);

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
        <div className="ig-row">
          <IconButton size="small" styleType="borderless" label={`Undo filter change (${formatShortcut({ key: "z", mod: true })})`} disabled={!canUndo}
            onClick={() => void runCommand("edit.undo", "ui")}><SvgUndo /></IconButton>
          <IconButton size="small" styleType="borderless" label={`Redo filter change (${formatShortcut({ key: "z", mod: true, shift: true })})`} disabled={!canRedo}
            onClick={() => void runCommand("edit.redo", "ui")}><SvgRedo /></IconButton>
          {(!isFilterEmpty(f) || excluded.length > 0) && <button className="ig-link" onClick={() => graphActions.clearFilters()}>Clear all</button>}
        </div>
      </div>
      <Text variant="small" isMuted>✓ include only · ✕ exclude · sub-models follow their parent unless set · the centre is never hidden.</Text>

      <ModelTreeList models={models} states={f.models} onChange={(models) => updateFilters((x) => ({ ...x, models }))} />
      <StateList title="Schemas" searchable
        items={schemas.map((s) => ({ key: s, label: s }))}
        states={f.schemas} onChange={(schemas) => updateFilters((x) => ({ ...x, schemas }))} />
      <ClassFilterSection title="Classes" names={classNames} entries={f.classes}
        onChange={(classes) => updateFilters((x) => ({ ...x, classes }))} />
      <ClassFilterSection title="Relationships" names={relNames} entries={f.relationships}
        onChange={(relationships) => updateFilters((x) => ({ ...x, relationships }))} />
      {excluded.length > 0 && <Section title="Excluded instances" count={excluded.length}>
        <Text variant="small" isMuted>These instances and paths through them are excluded. Changing this list clears Back/Forward history.</Text>
        {excluded.map((key) => {
          const [classId, id] = key.split(":");
          return <div key={key} className="ig-filter-row">
            <span className="ig-filter-row__name">{engine.registry.nameOf(classId)} <code>{id}</code></span>
            <button className="ig-x" title={`Remove instance exclusion ${key}`} onClick={() => graphActions.removeInstanceExclusion(key)}>×</button>
          </div>;
        })}
        <button className="ig-link" onClick={() => graphActions.setOptions({ excludedInstances: [] })}>Clear instance exclusions</button>
      </Section>}
    </div>
  );
}
