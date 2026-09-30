import { SvgFitToView } from "@itwin/itwinui-icons-react";
import { Button, IconButton, ProgressRadial, Select, Text } from "@itwin/itwinui-react";
import {
  Background, type EdgeMarker, Handle, MarkerType, MiniMap, type Node, type NodeProps, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import { memo, useEffect, useMemo, useState } from "react";
import { type ClassGraphData, type ClassGraphEdge, type ClassGraphNode, collapseToClasses, emptyClassGraph } from "../engine/classGraph";
import type { GraphData, GraphEdge } from "../engine/GraphModel";
import { requestSeedQuery } from "../state/censusStore";
import { classGraphActions, type ClassGraphScope, useClassGraphStore } from "../state/classGraphStore";
import { colorFor, contrastText } from "../state/colorTheme";
import { useGraphStore } from "../state/graphStore";
import { showSchemaFor } from "../widgets/SchemaWidget";
import { useFeature } from "../state/featureStore";
import { layeredLayout, NODE_HEIGHT, NODE_WIDTH, type Positions } from "./layout";
import { ModeToggle } from "./ModeToggle";
import { RelationshipEdge, type RelationshipFlowEdge } from "./RelationshipEdge";
import "./graph.css";

interface ClassNodeData extends Record<string, unknown> {
  readonly node: ClassGraphNode;
  readonly color: string;
  readonly isSelected: boolean;
}

type ClassFlowNode = Node<ClassNodeData, "classNode">;

const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, left: "50%", top: "50%", pointerEvents: "none" } as const;

function ClassNodeView({ data }: NodeProps<ClassFlowNode>) {
  const { node, color, isSelected } = data;
  const [schemaName, shortName] = node.className.split(":");
  return (
    <div className={`ig-node ig-classnode${isSelected ? " ig-node--selected" : ""}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT - 12, borderColor: color }}
      title={`${node.className}\nDouble-click to explore instances`}>
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />
      <div className="ig-node__header" style={{ background: color, color: contrastText(color) }}>
        <span className="ig-node__class">{shortName ?? node.className}</span>
        <span className="ig-node__schema">{schemaName}</span>
      </div>
      <div className="ig-node__body ig-classnode__body">
        <span className="ig-classnode__count">
          {node.instanceCount !== undefined ? `${node.instanceCount.toLocaleString()} instance${node.instanceCount === 1 ? "" : "s"}` : "count unknown"}
        </span>
      </div>
    </div>
  );
}

const ClassNode = memo(ClassNodeView);
const nodeTypes = { classNode: ClassNode };
const edgeTypes = { relationship: RelationshipEdge };

/** `layeredLayout` only reads node keys and edge endpoints, so the class graph can borrow it. */
function asLayoutGraph(data: ClassGraphData): GraphData {
  return { centreKey: "", truncated: false, nodes: data.nodes, edges: data.edges } as unknown as GraphData;
}

function filterGraph(data: ClassGraphData, needle: string): ClassGraphData {
  const q = needle.trim().toLowerCase();
  if (!q) return data;
  const nodes = new Map([...data.nodes].filter(([, n]) => n.className.toLowerCase().includes(q)));
  const edges = new Map([...data.edges].filter(([, e]) => nodes.has(e.source) && nodes.has(e.target)));
  return { nodes, edges };
}

/** A class edge dressed as a {@link GraphEdge} so {@link RelationshipEdge} can draw it. */
function asGraphEdge(e: ClassGraphEdge): GraphEdge {
  return {
    key: e.key, source: e.source, target: e.target, relClassId: e.relClassId,
    relClassName: e.relClassName, relInstanceId: "", kind: e.kind, cardinality: e.cardinality,
  };
}

const SCOPES: Array<{ value: ClassGraphScope; label: string }> = [
  { value: "neighbourhood", label: "Neighbourhood" },
  { value: "imodel", label: "Whole iModel" },
];

function ClassGraphCanvasInner() {
  const scope = useClassGraphStore((s) => s.scope);
  const imodelGraph = useClassGraphStore((s) => s.imodelGraph);
  const building = useClassGraphStore((s) => s.building);
  const progress = useClassGraphStore((s) => s.progress);
  const error = useClassGraphStore((s) => s.error);
  const selection = useClassGraphStore((s) => s.selection);
  const instanceGraph = useGraphStore((s) => s.graph);
  const engine = useGraphStore((s) => s.engine);
  const theme = useGraphStore((s) => s.theme);
  const rf = useReactFlow();
  const imodelScopeOn = useFeature("classGraph.imodel");
  const scopes = imodelScopeOn ? SCOPES : SCOPES.filter((s) => s.value !== "imodel");

  const [search, setSearch] = useState("");
  const [positions, setPositions] = useState<Positions>(new Map());

  const data = useMemo<ClassGraphData>(() => {
    if (scope === "imodel") return imodelGraph ?? emptyClassGraph();
    return engine ? collapseToClasses(instanceGraph, engine.registry) : emptyClassGraph();
  }, [scope, imodelGraph, instanceGraph, engine]);

  const shown = useMemo(() => filterGraph(data, search), [data, search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const target = await layeredLayout(asLayoutGraph(shown));
        if (cancelled) return;
        setPositions(target);
        // Fit once the layout settles; streamed updates keep the camera where the user put it.
        if (shown.nodes.size > 0 && !building)
          setTimeout(() => { if (!cancelled) void rf.fitView({ padding: 0.15, duration: 300 }); }, 30);
      } catch { /* elk worker interrupted; the next layout run recovers */ }
    })();
    return () => { cancelled = true; };
  }, [shown, building, rf]);

  const nodes: ClassFlowNode[] = useMemo(() => {
    const out: ClassFlowNode[] = [];
    for (const n of shown.nodes.values()) {
      const position = positions.get(n.key);
      if (!position) continue;
      out.push({
        id: n.key, type: "classNode", position, draggable: false, selectable: false,
        data: { node: n, color: colorFor(n, theme), isSelected: selection?.kind === "class" && selection.key === n.key },
      });
    }
    return out;
  }, [shown, positions, theme, selection]);

  const edges: RelationshipFlowEdge[] = useMemo(() => {
    const pairCount = new Map<string, number>();
    const pairKey = (e: ClassGraphEdge) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`);
    for (const e of shown.edges.values()) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
    const pairSeen = new Map<string, number>();
    return [...shown.edges.values()].map((e) => {
      const pk = pairKey(e);
      const idx = pairSeen.get(pk) ?? 0;
      pairSeen.set(pk, idx + 1);
      const marker: EdgeMarker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.kind === "linkTable" ? "#d9822b" : "#7a8ca3" };
      return {
        id: e.key, source: e.source, target: e.target, type: "relationship" as const, markerEnd: marker, selectable: false,
        data: {
          edge: asGraphEdge(e), count: e.count, parallelIndex: idx, parallelCount: pairCount.get(pk)!,
          leaving: false, highlighted: false, isSelected: selection?.kind === "edge" && selection.key === e.key,
        },
      };
    });
  }, [shown, selection]);

  const statusText = error ? error
    : building ? `Building class graph… ${progress ? `${progress.done} of ${progress.total} relationship classes` : ""}`
      : shown.nodes.size > 0 ? `${shown.nodes.size} classes, ${shown.edges.size} relationships`
        : "";

  return (
    <div className="ig-canvas">
      <ReactFlow<ClassFlowNode, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => { classGraphActions.select({ kind: "class", key: n.id }); showSchemaFor(n.data.node.className); }}
        onNodeDoubleClick={(_, n) => {
          classGraphActions.setMode("instances");
          requestSeedQuery(`SELECT ECInstanceId, ECClassId FROM ONLY ${n.data.node.className.replace(":", ".")} LIMIT 100`);
        }}
        onEdgeClick={(_, e) => { classGraphActions.select({ kind: "edge", key: e.id }); showSchemaFor((e.data as { edge: GraphEdge }).edge.relClassName); }}
        onPaneClick={() => classGraphActions.select(undefined)}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        maxZoom={2.5}
        onlyRenderVisibleElements={nodes.length > 300}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.data as ClassNodeData).color} nodeStrokeWidth={0} />
        <Panel position="top-left" className="ig-toolbar">
          <ModeToggle />
          <div className="ig-toolbar__select">
            <Select<ClassGraphScope> size="small" options={scopes} value={scope} onChange={(s) => classGraphActions.setScope(s)} />
          </div>
          <input className="ig-filter-input ig-toolbar__search" placeholder="Filter classes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <IconButton size="small" styleType="borderless" label="Fit to view" onClick={() => void rf.fitView({ padding: 0.15, duration: 300 })}><SvgFitToView /></IconButton>
          {building && <Button size="small" onClick={() => classGraphActions.cancelBuild()}>Cancel</Button>}
        </Panel>
        <Panel position="bottom-left" className="ig-status">
          {building && <ProgressRadial size="x-small" indeterminate />}
          <Text variant="small" className={error ? "ig-status--error" : undefined}>{statusText}</Text>
        </Panel>
      </ReactFlow>
      {shown.nodes.size === 0 && !building && (
        <div className="ig-empty">
          <div className="ig-empty__title">No classes to show</div>
          <div>
            {scope === "neighbourhood"
              ? `Load an instance graph first (Seed query or the 3D view)${imodelScopeOn ? ", or switch the scope to Whole iModel" : ""}.`
              : search ? "No class matches the filter." : "The whole-iModel class graph is empty."}
          </div>
        </div>
      )}
    </div>
  );
}

/** Class-level view: one node per EC class observed in the data, edges per relationship class with
 * instance counts — the "observed schema" beside the instance graph. */
export function ClassGraphCanvas() {
  return (
    <ReactFlowProvider>
      <ClassGraphCanvasInner />
    </ReactFlowProvider>
  );
}
