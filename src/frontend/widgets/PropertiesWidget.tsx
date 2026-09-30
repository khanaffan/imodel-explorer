import { Button, Text } from "@itwin/itwinui-react";
import { useEffect, useState } from "react";
import type { GraphEdge, GraphNode } from "../engine/GraphModel";
import { loadInstanceProperties, type PropertyRecord, resolveNavTargetClassId } from "../engine/instanceProperties";
import { graphActions, useGraphStore } from "../state/graphStore";
import { colorFor } from "../state/colorTheme";
import { useFeature } from "../state/featureStore";
import { filterEdits } from "./FiltersWidget";
import { viewportSync } from "../content/viewportSync";
import { Constraint } from "./Constraint";
import { showSchemaFor } from "./SchemaWidget";
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

async function goToNavTarget(p: PropertyRecord) {
  const engine = useGraphStore.getState().engine;
  if (!engine || !p.navTarget) return;
  const classId = await resolveNavTargetClassId(engine.port, p.navTarget);
  if (classId) await graphActions.centreOn({ id: p.navTarget.id, classId });
}

function PropertyRow({ p, depth = 0 }: { p: PropertyRecord; depth?: number }) {
  const [open, setOpen] = useState(depth === 0 && (p.children?.length ?? 0) <= 6);
  const hasChildren = (p.children?.length ?? 0) > 0;
  return (
    <>
      <div className={`ig-prop ig-prop--${p.kind}`} style={{ paddingLeft: 4 + depth * 12 }}>
        <span className="ig-prop__name" title={p.name}>
          {hasChildren && <button className="ig-caret" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>}
          {p.label}
        </span>
        <span className="ig-prop__value" title={p.value}>
          {p.navTarget
            ? <button className="ig-link" onClick={() => void goToNavTarget(p)} title={`Go to ${p.navTarget.id} via ${p.navTarget.relClassName}`}>{p.value || p.navTarget.id}</button>
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
  if (loading) return <Text variant="small" isMuted>Loading properties…</Text>;
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

function NodeDetails({ node }: { node: GraphNode }) {
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
        <div className="ig-card__sub">Id <code>{node.id}</code> · ClassId <code>{node.classId}</code></div>
        {node.modelName && <div className="ig-card__sub">Model {node.modelName} <code>{node.modelId}</code></div>}
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
      <PropertyTable className={node.className} id={node.id} />
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
