import { UiFramework } from "@itwin/appui-react";
import { Button, Input, Text } from "@itwin/itwinui-react";
import { useEffect, useMemo, useState } from "react";
import { type ClassRef, describeClass, formatArrayBounds, type PropertyGroup, type PropertyInfo, type SchemaClassInfo, searchClassNames } from "../engine/schemaInfo";
import { isFeatureEnabled } from "../state/featureStore";
import { graphActions, type GraphState, sameSelection, useGraphStore } from "../state/graphStore";
import { Constraint } from "./Constraint";
import "./widgets.css";

export const SCHEMA_WIDGET_ID = "ig-schema";

/** Point the Schema widget at a class and bring its tab to the front. No-op when the Schema
 * feature is switched off (the widget does not exist then). */
export function showSchemaFor(className: string): void {
  if (!isFeatureEnabled("schema")) return;
  graphActions.exploreSchema(className);
  UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(SCHEMA_WIDGET_ID)?.show();
}

function selectedClassName(s: GraphState): string | undefined {
  if (s.selection?.kind === "node") {
    const node = s.graph.nodes.get(s.selection.key);
    return node?.aggregate ? node.aggregate.relClassName : node?.className;
  }
  if (s.selection?.kind === "edge")
    return s.graph.edges.get(s.selection.key)?.relClassName;
  return undefined;
}

/** The explicitly explored class while the selection is unchanged, otherwise the selected class. */
function useShownClass(): { className?: string; following: boolean } {
  const focus = useGraphStore((s) => (s.schemaFocus && sameSelection(s.schemaFocus.forSelection, s.selection) ? s.schemaFocus.className : undefined));
  const selected = useGraphStore(selectedClassName);
  return focus ? { className: focus, following: false } : { className: selected, following: true };
}

const TYPE_LABELS: Record<ClassRef["type"], string> = {
  entity: "Entity", relationship: "Relationship", struct: "Struct", customAttribute: "Custom attribute", mixin: "Mixin", view: "View",
};

function ClassLink({ c, onOpen, current }: { c: ClassRef | string; onOpen: (n: string) => void; current?: boolean }) {
  const name = typeof c === "string" ? c : c.fullName;
  const title = typeof c === "string" ? name : `${name}${c.label ? ` — ${c.label}` : ""} (${TYPE_LABELS[c.type]})`;
  if (current) return <b title={title}>{name}</b>;
  return <button className="ig-link" title={title} onClick={() => onOpen(name)}>{name}</button>;
}

function Collapsible({ title, count, defaultOpen, children }: { title: React.ReactNode; count?: number; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="ig-props__section ig-schema__section">
        <button className="ig-caret" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "▾" : "▸"}</button>
        {title}{count !== undefined && <span className="ig-muted"> ({count})</span>}
      </div>
      {open && children}
    </>
  );
}

function hasDetail(p: PropertyInfo): boolean {
  const d = p.detail;
  return !!(p.description || d.enumeration || d.kindOfQuantity || d.extendedType || d.category || d.structClass || d.relationshipClass || d.arrayMin !== undefined || d.arrayMax !== undefined);
}

function PropertyDetailView({ p, onOpen }: { p: PropertyInfo; onOpen: (n: string) => void }) {
  const d = p.detail;
  return (
    <div className="ig-schema__detail">
      {p.description && <div className="ig-muted">{p.description}</div>}
      <div className="ig-grid2">
        <label>Kind</label><div>{p.kind}</div>
        {d.structClass && <><label>Struct</label><div><ClassLink c={d.structClass} onOpen={onOpen} /></div></>}
        {d.relationshipClass && <><label>Relationship</label><div><ClassLink c={d.relationshipClass} onOpen={onOpen} /> ({d.direction})</div></>}
        {(d.arrayMin !== undefined || d.arrayMax !== undefined) && <><label>Occurs</label><div>{formatArrayBounds(d.arrayMin, d.arrayMax)}</div></>}
        {d.extendedType && <><label>Extended type</label><div><code>{d.extendedType}</code></div></>}
        {d.kindOfQuantity && <><label>KindOfQuantity</label><div><code>{d.kindOfQuantity.fullName}</code> <span className="ig-muted">({d.kindOfQuantity.persistenceUnit})</span></div></>}
        {d.category && <><label>Category</label><div><code>{d.category}</code></div></>}
        {d.enumeration && <><label>Enumeration</label><div><code>{d.enumeration.fullName}</code>{d.enumeration.isStrict ? "" : <span className="ig-muted"> (non-strict)</span>}</div></>}
      </div>
      {d.enumeration && (
        <div className="ig-schema__enum">
          {d.enumeration.enumerators.map((e) => (
            <div key={e.name} className="ig-prop"><span className="ig-prop__name" title={e.name}>{e.label ?? e.name}</span><span className="ig-prop__value">{String(e.value)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyRow({ p, onOpen }: { p: PropertyInfo; onOpen: (n: string) => void }) {
  const [open, setOpen] = useState(false);
  const expandable = hasDetail(p);
  return (
    <>
      <div className="ig-prop">
        <span className="ig-prop__name" title={`${p.name}${p.label ? ` — ${p.label}` : ""}`}>
          {expandable ? <button className="ig-caret" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button> : <span className="ig-caret ig-caret--spacer" />}
          {p.name}{p.isReadOnly && <span className="ig-muted" title="Read-only"> 🔒</span>}
        </span>
        <span className="ig-prop__value" title={p.typeText}>{p.typeText}</span>
      </div>
      {open && <PropertyDetailView p={p} onOpen={onOpen} />}
    </>
  );
}

function PropertyGroupView({ g, onOpen }: { g: PropertyGroup; onOpen: (n: string) => void }) {
  return (
    <Collapsible
      defaultOpen={g.isOwn}
      count={g.properties.length}
      title={g.isOwn ? <>Own properties</> : <>From <ClassLink c={g.declaringClass} onOpen={onOpen} /></>}>
      <div className="ig-props">
        {g.properties.length === 0 ? <Text variant="small" isMuted>None</Text> : g.properties.map((p) => <PropertyRow key={p.name} p={p} onOpen={onOpen} />)}
      </div>
    </Collapsible>
  );
}

function ClassDetails({ info, onOpen }: { info: SchemaClassInfo; onOpen: (n: string) => void }) {
  const { self, schema, relationship } = info;
  return (
    <>
      <div className="ig-card">
        <div className="ig-card__title">{self.fullName}</div>
        {self.label && <div className="ig-card__sub">{self.label}</div>}
        <div className="ig-row ig-row--wrap">
          <span className={`ig-badge ig-badge--${self.type}`}>{TYPE_LABELS[self.type]}</span>
          {info.modifier !== "none" && <span className="ig-badge">{info.modifier === "abstract" ? "Abstract" : "Sealed"}</span>}
          <span className="ig-muted">{info.propertyCount} properties</span>
        </div>
        {info.description && <div className="ig-card__sub">{info.description}</div>}
      </div>

      <div className="ig-props__section">Schema</div>
      <div className="ig-grid2">
        <label>Name</label><div><b>{schema.name}</b> <code>{schema.version}</code></div>
        <label>Alias</label><div><code>{schema.alias}</code></div>
        {schema.label && <><label>Label</label><div>{schema.label}</div></>}
        {schema.description && <><label>Description</label><div className="ig-muted">{schema.description}</div></>}
      </div>

      <div className="ig-props__section">Hierarchy</div>
      <div className="ig-schema__chain">
        {info.baseChain.map((c, i) => (
          <div key={c.fullName} style={{ paddingLeft: i * 10 }}>
            {i > 0 && <span className="ig-muted">└ </span>}
            <ClassLink c={c} onOpen={onOpen} current={i === info.baseChain.length - 1} />
          </div>
        ))}
      </div>
      {info.mixins.length > 0 && (
        <div className="ig-row ig-row--wrap">
          <span className="ig-muted">Mixins</span>
          {info.mixins.map((m) => (
            <button key={m.fullName} className={`ig-chip ig-chip--neutral${m.via ? " ig-chip--inherited" : ""}`}
              title={`${m.label ?? m.fullName}${m.via ? ` (via ${m.via})` : ""}`} onClick={() => onOpen(m.fullName)}>{m.fullName}</button>
          ))}
        </div>
      )}

      {relationship && (
        <>
          <div className="ig-props__section">Relationship</div>
          <div>Strength <b>{relationship.strength}</b> ({relationship.strengthDirection})</div>
          {relationship.source && <Constraint title="Source" c={relationship.source} onClassClick={onOpen} />}
          {relationship.target && <Constraint title="Target" c={relationship.target} onClassClick={onOpen} />}
        </>
      )}

      {info.propertyGroups.map((g) => <PropertyGroupView key={`${self.fullName}|${g.declaringClass.fullName}`} g={g} onOpen={onOpen} />)}

      <Collapsible key={`derived|${self.fullName}`} title="Derived classes" count={info.derivedClasses.length} defaultOpen={info.derivedClasses.length > 0 && info.derivedClasses.length <= 10}>
        <div className="ig-list ig-list--short">
          {info.derivedClasses.length === 0
            ? <Text variant="small" isMuted>None</Text>
            : info.derivedClasses.map((c) => <div key={c.fullName}><ClassLink c={c} onOpen={onOpen} /></div>)}
        </div>
      </Collapsible>
    </>
  );
}

export function SchemaWidget() {
  const engine = useGraphStore((s) => s.engine);
  const selectionId = useGraphStore((s) => (s.selection ? `${s.selection.kind}:${s.selection.key}` : ""));
  const { className, following } = useShownClass();
  const [history, setHistory] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // A new graph selection starts a fresh browsing trail.
  useEffect(() => { setHistory([]); }, [selectionId, engine]);

  const allNames = useMemo(() => engine?.registry.allClassNames() ?? [], [engine]);
  const matches = useMemo(() => searchClassNames(allNames, search), [allNames, search]);
  const info = useMemo(() => (engine && className ? describeClass(engine.registry.view, className) : undefined), [engine, className]);

  if (!engine)
    return <div className="ig-widget"><Text isMuted>Open an iModel to explore its schemas.</Text></div>;

  const open = (name: string) => {
    if (name === className) return;
    if (className) setHistory((h) => [...h, className]);
    setSearch("");
    graphActions.exploreSchema(name);
  };
  const back = () => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    graphActions.exploreSchema(prev);
  };

  return (
    <div className="ig-widget">
      <div className="ig-row">
        <Button size="small" styleType="borderless" disabled={history.length === 0} onClick={back} title="Back">←</Button>
        <Input size="small" placeholder="Search any class…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!following && <Button size="small" styleType="borderless" onClick={() => { setHistory([]); graphActions.exploreSchema(undefined); }} title="Show the class of the graph selection">Follow selection</Button>}
      </div>
      {matches.length > 0 && (
        <div className="ig-list ig-list--short">
          {matches.map((n) => <button key={n} className="ig-list__item" onClick={() => open(n)}><span className="ig-list__primary">{n}</span></button>)}
        </div>
      )}
      {info
        ? <ClassDetails info={info} onOpen={open} />
        : <Text isMuted>{className ? `Class ${className} was not found in the schemas.` : "Select a node or relationship, or search for a class."}</Text>}
    </div>
  );
}
