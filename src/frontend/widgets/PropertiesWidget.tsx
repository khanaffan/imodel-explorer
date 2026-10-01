import { Button, Text, Textarea } from "@itwin/itwinui-react";
import { useEffect, useState } from "react";
import type { GraphEdge, GraphNode } from "../engine/GraphModel";
import { loadInstanceProperties, type PropertyRecord } from "../engine/instanceProperties";
import { filterEdits, graphActions, useGraphStore } from "../state/graphStore";
import { colorFor } from "../state/colorTheme";
import { useFeature } from "../state/featureStore";
import { viewportSync } from "../content/viewportSync";
import { Constraint } from "./Constraint";
import { showSchemaFor } from "./SchemaWidget";
import { ElementProperties } from "./ElementProperties";
import { InstanceLink } from "./InstanceLink";
import { Skeleton } from "./Skeleton";
import { annotationActions, NOTE_MAX_LENGTH, useNote } from "../services/annotations";
import { notify } from "../commands/notify";
import "./widgets.css";

function usePropertyRecords(className: string | undefined, id: string | undefined) {
  const engine = useGraphStore((s) => s.engine);
  const [state, setState] = useState<{ records?: PropertyRecord[]; error?: string; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (!engine || !className || !id) { setState({ loading: false }); return; }
    let live = true;
    setState({ loading: true });
    loadInstanceProperties(engine.port, engine.registry, className, id)
      .then((records) => live && setState({ records, loading: false }))
      .catch((e) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => { live = false; };
  }, [engine, className, id]);
  return state;
}

function PropertyRow({ p, depth = 0 }: { p: PropertyRecord; depth?: number }) {
  const [open, setOpen] = useState(depth === 0 && (p.children?.length ?? 0) <= 6);
  const hasChildren = (p.children?.length ?? 0) > 0;
  const reference = p.navTarget ?? p.reference;
  return (
    <>
      <div className={`ig-prop ig-prop--${p.kind}`} style={{ paddingLeft: 4 + depth * 12 }}>
        <span className="ig-prop__name" title={p.name}>
          {hasChildren && <button className="ig-caret" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>}
          {p.label}
        </span>
        <span className="ig-prop__value" title={p.value}>
          {reference
            ? <InstanceLink reference={reference}>{p.value || reference.id}</InstanceLink>
            : p.value}
        </span>
      </div>
      {open && p.children?.map((c) => <PropertyRow key={c.name} p={c} depth={depth + 1} />)}
    </>
  );
}

function PropertyTable({ className, id, emptyText }: { className: string; id: string; emptyText?: string }) {
  const { records, error, loading } = usePropertyRecords(className, id);
  const [showEmpty, setShowEmpty] = useState(false);
  if (loading) return <Skeleton label="Loading properties" rows={6} />;
  if (error) return <div className="ig-error">{error}</div>;
  if (!records || records.length === 0) return <Text variant="small" isMuted>{emptyText ?? "No properties"}</Text>;
  const system = records.filter((r) => r.kind === "system");
  const rest = records.filter((r) => r.kind !== "system" && (showEmpty || r.value !== "" || (r.children?.length ?? 0) > 0));
  const hidden = records.filter((r) => r.kind !== "system").length - rest.length;
  return (
    <div className="ig-props">
      {rest.map((p) => <PropertyRow key={p.name} p={p} />)}
      {hidden > 0 && <button className="ig-link" onClick={() => setShowEmpty(true)}>Show {hidden} empty properties</button>}
      <div className="ig-props__section">System</div>
      {system.map((p) => <PropertyRow key={p.name} p={p} />)}
    </div>
  );
}

/** A free-text note on the instance, kept per iModel file. Saved on blur or ⌘/Ctrl+Enter. */
function NoteEditor({ fileName, nodeKey }: { fileName: string; nodeKey: string }) {
  const saved = useNote(fileName, nodeKey) ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = draft.trim() !== saved;
  const save = () => {
    if (!dirty) return;
    try {
      annotationActions.setNote(fileName, nodeKey, draft);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="ig-note">
      <label className="ig-props__section" htmlFor={`ig-note-${nodeKey}`}>Note{dirty ? " (unsaved)" : ""}</label>
      <Textarea id={`ig-note-${nodeKey}`} rows={2} maxLength={NOTE_MAX_LENGTH} placeholder="Add a note about this instance…" value={draft}
        data-testid="node-note" onChange={(e) => setDraft(e.target.value)} onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
          else if (e.key === "Escape") { e.stopPropagation(); setDraft(saved); }
        }} />
      {saved && !dirty && <button className="ig-link" onClick={() => annotationActions.setNote(fileName, nodeKey, "")}>Remove note</button>}
    </div>
  );
}

function NodeDetails({ node }: { node: GraphNode }) {
  const fileName = useGraphStore((s) => s.fileName);
  const connection = useGraphStore((s) => s.connection);
  const theme = useGraphStore((s) => s.theme);
  const isCentre = useGraphStore((s) => s.graph.centreKey === node.key);
  const isPinned = useGraphStore((s) => s.pins.has(node.key));
  const schemaOn = useFeature("schema");
  const edges = useGraphStore((s) => [...s.graph.edges.values()].filter((e) => e.source === node.key || e.target === node.key).length);

  if (node.aggregate) {
    return (
      <div className="ig-widget">
        <Text variant="leading">{node.aggregate.hiddenCount} more related instances</Text>
        <Text variant="small">via <code>{node.aggregate.relClassName}</code> ({node.aggregate.direction})</Text>
        <Button size="small" styleType="high-visibility" onClick={() => void graphActions.openAggregate(node.key)}>Load them</Button>
      </div>
    );
  }

  return (
    <div className="ig-widget">
      <div className="ig-card" style={{ borderLeftColor: colorFor(node, theme) }}>
        <div className="ig-card__title">{node.label}</div>
        <div className="ig-card__sub">{schemaOn
          ? <button className="ig-link" title="Show this class in the Schema panel" onClick={() => showSchemaFor(node.className)}><code>{node.className}</code></button>
          : <code>{node.className}</code>}</div>
        <div className="ig-card__sub">Id <InstanceLink reference={{ id: node.id, classId: node.classId }}><code>{node.id}</code></InstanceLink> · ClassId <code>{node.classId}</code></div>
        {node.modelId && <div className="ig-card__sub">Model {node.modelName} <InstanceLink reference={{ id: node.modelId, targetBaseClass: "BisCore:Model" }}><code>{node.modelId}</code></InstanceLink></div>}
        <div className="ig-card__sub">{node.depth} hop{node.depth === 1 ? "" : "s"} from centre · {edges} relationship{edges === 1 ? "" : "s"} shown</div>
      </div>
      <div className="ig-row ig-row--wrap">
        <Button size="small" styleType={isPinned ? "high-visibility" : "default"} onClick={() => graphActions.togglePin(node.key)}
          title="Pinned nodes stay in view while you click through the graph, as long as they stay related to the centre or another pin">{isPinned ? "Unpin" : "Pin"}</Button>
        {!isCentre && <Button size="small" onClick={() => void graphActions.centreOn({ id: node.id, classId: node.classId })}>Centre here</Button>}
        {!isCentre && <Button size="small" onClick={() => node.expanded ? graphActions.collapse(node.key) : void graphActions.expand(node.key)}>{node.expanded ? "Collapse" : "Expand"}</Button>}
        {node.category.startsWith("geometric") && <Button size="small" onClick={() => viewportSync.zoomTo(node.id)}>Show in 3D</Button>}
        {!isCentre && <Button size="small" styleType="borderless" onClick={() => filterEdits.excludeClass(node.className)}>Hide class</Button>}
        {!isCentre && node.modelId && <Button size="small" styleType="borderless" onClick={() => filterEdits.excludeModel(node.modelId!)}>Hide model</Button>}
      </div>
      {fileName && <NoteEditor fileName={fileName} nodeKey={node.key} />}
      {connection && node.classHierarchy.includes("BisCore:Element")
        ? <ElementProperties imodel={connection} className={node.className} id={node.id} />
        : <PropertyTable className={node.className} id={node.id} />}
    </div>
  );
}

function EdgeDetails({ edge }: { edge: GraphEdge }) {
  const engine = useGraphStore((s) => s.engine);
  const source = useGraphStore((s) => s.graph.nodes.get(edge.source));
  const target = useGraphStore((s) => s.graph.nodes.get(edge.target));
  const schemaOn = useFeature("schema");
  const info = engine?.relationships.get(edge.relClassId);
  const endpoint = (n: GraphNode | undefined) => n && (
    <button className="ig-link" onClick={() => graphActions.select({ kind: "node", key: n.key })}>{n.label} <span className="ig-muted">({n.className.split(":")[1]})</span></button>
  );
  return (
    <div className="ig-widget">
      <div className="ig-card" style={{ borderLeftColor: edge.kind === "linkTable" ? "#d9822b" : "#7a8ca3" }}>
        <div className="ig-card__title">{schemaOn
          ? <button className="ig-link" title="Show this relationship class in the Schema panel" onClick={() => showSchemaFor(edge.relClassName)}>{edge.relClassName}</button>
          : edge.relClassName}</div>
        <div className="ig-card__sub">
          {edge.kind === "linkTable" ? "Link-table relationship (has its own instance)" : edge.kind === "navigation" ? <>Navigation property <code>{edge.navPropertyName}</code></> : "Summary"}
        </div>
        {info && <div className="ig-card__sub">Strength {info.strength} ({info.strengthDirection})</div>}
      </div>
      <div className="ig-grid2">
        <label>Source</label><div>{endpoint(source)}</div>
        <label>Target</label><div>{endpoint(target)}</div>
      </div>
      {info && <Constraint title="Source" c={info.source} />}
      {info && <Constraint title="Target" c={info.target} />}
      <Button size="small" styleType="borderless" onClick={() => filterEdits.excludeRelationship(edge.relClassName)}>Hide this relationship class</Button>
      {edge.kind === "linkTable" && (
        <>
          <div className="ig-props__section">Relationship instance {edge.relInstanceId}</div>
          <PropertyTable className={edge.relClassName} id={edge.relInstanceId} emptyText="This relationship instance has no properties." />
        </>
      )}
    </div>
  );
}

export function PropertiesWidget() {
  return <div className="ig-widget-host" data-tour="properties"><PropertiesContent /></div>;
}

function PropertiesContent() {
  const selection = useGraphStore((s) => s.selection);
  const node = useGraphStore((s) => (s.selection?.kind === "node" ? s.graph.nodes.get(s.selection.key) : undefined));
  const edge = useGraphStore((s) => (s.selection?.kind === "edge" ? s.graph.edges.get(s.selection.key) : undefined));
  if (node) return <NodeDetails key={node.key} node={node} />;
  if (edge) return <EdgeDetails key={edge.key} edge={edge} />;
  return (
    <div className="ig-widget">
      <Text isMuted>{selection ? "Selection is no longer in the graph." : "Select a node or relationship. Shift-click a node to inspect it without recentring."}</Text>
    </div>
  );
}
