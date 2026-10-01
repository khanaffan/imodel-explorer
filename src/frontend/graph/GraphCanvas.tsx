import {
  Background, type EdgeMarker, MarkerType, MiniMap, type NodeChange, ReactFlow, ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphEdge, GraphNode } from "../engine/GraphModel";
import { colorFor } from "../state/colorTheme";
import { graphActions, useGraphStore } from "../state/graphStore";
import { GraphToolbar } from "./GraphToolbar";
import { InstanceNode, type InstanceFlowNode } from "./InstanceNode";
import { avoidPinned, computeLayout, NODE_HEIGHT, NODE_WIDTH, type Point, type Positions } from "./layout";
import { DEFAULT_DURATION_MS, LayoutAnimator, LEAVE_DURATION_MS, prefersReducedMotion } from "./motion";
import { RelationshipEdge, type RelationshipFlowEdge } from "./RelationshipEdge";
import "./graph.css";
import { applyGraphTool, type GraphTool, type ToolResult } from "./graphTools";

const nodeTypes = { instance: InstanceNode };
const edgeTypes = { relationship: RelationshipEdge };
const RING_STAGGER_MS = 70;

interface Leaving {
  readonly nodes: Map<string, GraphNode>;
  readonly edges: Map<string, GraphEdge>;
}

function boundsOf(positions: Positions) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of positions.values()) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + NODE_WIDTH); y1 = Math.max(y1, p.y + NODE_HEIGHT);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

/** The graph to lay out: pins outside the traversal result that already have a place are left out,
 * so they don't distort the rings; they are positioned by their offset instead. */
function withoutPlacedPins(graph: GraphData, base: GraphData, placed: ReadonlyMap<string, Point>): GraphData {
  const skip = (k: string) => placed.has(k) && !base.nodes.has(k) && k !== graph.centreKey;
  if (![...placed.keys()].some(skip)) return graph;
  const nodes = new Map([...graph.nodes].filter(([k]) => !skip(k)));
  const edges = new Map([...graph.edges].filter(([, e]) => nodes.has(e.source) && nodes.has(e.target)));
  return { ...graph, nodes, edges };
}

function GraphCanvasInner() {
  const graph = useGraphStore((s) => s.graph);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const theme = useGraphStore((s) => s.theme);
  const selection = useGraphStore((s) => s.selection);
  const fitRequest = useGraphStore((s) => s.fitRequest);
  const pins = useGraphStore((s) => s.pins);
  const connection = useGraphStore((s) => s.connection);
  const rf = useReactFlow();
  const [tool, setTool] = useState<GraphTool>("navigate");
  const [feedback, setFeedback] = useState<ToolResult>();
  const changeTool = useCallback((next: GraphTool) => { setTool(next); setFeedback(undefined); }, []);
  useEffect(() => changeTool("navigate"), [connection, changeTool]);
  const clickEdge = useCallback((key: string) => {
    if (tool === "navigate") graphActions.select({ kind: "edge", key });
    else setFeedback(applyGraphTool(tool, { kind: "edge", key }));
  }, [tool]);

  const [positions, setPositions] = useState<Positions>(new Map());
  const [leaving, setLeaving] = useState<Leaving>({ nodes: new Map(), edges: new Map() });
  const [hovered, setHovered] = useState<string>();
  const measured = useRef(new Map<string, { width: number; height: number }>());
  const animator = useMemo(() => new LayoutAnimator((p) => setPositions(p)), []);
  const shown = useRef<GraphData>(graph);
  const handledFit = useRef(0);
  const firstEnter = useRef(new Map<string, number>());

  useEffect(() => () => animator.stop(), [animator]);

  // Every graph change: lay out, animate from where nodes are now, fade out what left, move the camera.
  useEffect(() => {
    let cancelled = false;
    const before = shown.current;
    const previousPositions = animator.current;
    const { pins: currentPins, baseGraph } = useGraphStore.getState();
    // Offsets from the centre: stored ones, or where a newly pinned node is now relative to the
    // node about to be centre (so it stays put on screen while the camera follows the centre).
    const offsets = new Map<string, Point>();
    const fresh = new Map<string, Point>();
    const prevCentre = previousPositions.get(graph.centreKey);
    for (const [k, pin] of currentPins) {
      if (k === graph.centreKey || !graph.nodes.has(k)) continue;
      if (pin.offset) offsets.set(k, pin.offset);
      else if (prevCentre && previousPositions.has(k)) {
        const p = previousPositions.get(k)!;
        const o = { x: p.x - prevCentre.x, y: p.y - prevCentre.y };
        offsets.set(k, o);
        fresh.set(k, o);
      }
    }
    void (async () => {
      let target: Positions;
      try {
        target = await computeLayout(withoutPlacedPins(graph, baseGraph, offsets), layoutMode, previousPositions, before.centreKey !== graph.centreKey ? before.centreKey : undefined);
      } catch {
        return;
      }
      if (cancelled) return;
      const centrePos = target.get(graph.centreKey);
      const pinnedKeys = new Set<string>();
      if (centrePos) {
        for (const [k, pin] of currentPins) {
          if (k === graph.centreKey || !graph.nodes.has(k)) continue;
          pinnedKeys.add(k);
          const o = offsets.get(k);
          if (o) target.set(k, { x: centrePos.x + o.x, y: centrePos.y + o.y });
          else if (target.has(k) && !pin.offset) {
            const p = target.get(k)!;
            fresh.set(k, { x: p.x - centrePos.x, y: p.y - centrePos.y });
          }
        }
        target = avoidPinned(target, pinnedKeys, graph.centreKey);
      }
      for (const [k, o] of fresh) graphActions.setPinOffset(k, o);

      const gone: Leaving = { nodes: new Map(), edges: new Map() };
      for (const [k, n] of before.nodes)
        if (!graph.nodes.has(k) && previousPositions.has(k)) gone.nodes.set(k, n);
      for (const [k, e] of before.edges)
        if (!graph.edges.has(k) && (gone.nodes.has(e.source) || gone.nodes.has(e.target))) gone.edges.set(k, e);
      const withLeaving = new Map(target);
      for (const k of gone.nodes.keys()) withLeaving.set(k, previousPositions.get(k)!);
      setLeaving(gone);

      // Newcomers grow out of a neighbour that is already on screen.
      const spawn = (k: string): Point | undefined => {
        for (const e of graph.edges.values()) {
          const other = e.source === k ? e.target : e.target === k ? e.source : undefined;
          if (other && previousPositions.has(other)) return previousPositions.get(other);
        }
        return previousPositions.get(graph.centreKey);
      };
      for (const [k, n] of graph.nodes)
        if (!previousPositions.has(k) && !firstEnter.current.has(k)) firstEnter.current.set(k, n.depth * RING_STAGGER_MS);
      for (const k of [...firstEnter.current.keys()])
        if (previousPositions.has(k)) firstEnter.current.delete(k);

      const duration = prefersReducedMotion() ? 0 : DEFAULT_DURATION_MS;
      animator.animateTo(withLeaving, spawn, duration);
      shown.current = graph;

      if (gone.nodes.size > 0)
        setTimeout(() => { if (!cancelled) setLeaving({ nodes: new Map(), edges: new Map() }); }, Math.max(duration, LEAVE_DURATION_MS));

      const bounds = boundsOf(target);
      if (fitRequest !== handledFit.current && bounds) {
        handledFit.current = fitRequest;
        void rf.fitBounds(bounds, { padding: 0.15, duration });
      } else if (before.centreKey !== graph.centreKey && target.has(graph.centreKey)) {
        const c = target.get(graph.centreKey)!;
        void rf.setCenter(c.x + NODE_WIDTH / 2, c.y + NODE_HEIGHT / 2, { zoom: rf.getZoom(), duration });
      }
    })();
    return () => { cancelled = true; };
  }, [graph, layoutMode, fitRequest, animator, rf]);

  const selectedNode = selection?.kind === "node" ? selection.key : undefined;
  const selectedEdge = selection?.kind === "edge" ? selection.key : undefined;
  const focus = hovered ?? selectedNode;

  const nodeData = useMemo(() => {
    const m = new Map<string, InstanceFlowNode["data"]>();
    const add = (n: GraphNode, isLeaving: boolean) => m.set(n.key, {
      node: n, color: colorFor(n, theme), isCentre: n.key === graph.centreKey, isSelected: n.key === selectedNode, isPinned: pins.has(n.key),
      leaving: isLeaving, enterDelayMs: firstEnter.current.get(n.key) ?? 0,
    });
    for (const n of graph.nodes.values()) add(n, false);
    for (const n of leaving.nodes.values()) if (!m.has(n.key)) add(n, true);
    return m;
  }, [graph, leaving, theme, selectedNode, pins]);

  const nodes: InstanceFlowNode[] = useMemo(() => {
    const out: InstanceFlowNode[] = [];
    for (const [k, data] of nodeData) {
      const position = positions.get(k);
      if (!position) continue;
      out.push({
        id: k, type: "instance", position, data,
        measured: measured.current.get(k), selectable: false, zIndex: data.isCentre ? 10 : data.isSelected ? 5 : 0,
      });
    }
    return out;
  }, [nodeData, positions]);

  const edges: RelationshipFlowEdge[] = useMemo(() => {
    const all = [...graph.edges.values()].map((e) => ({ e, leaving: false }))
      .concat([...leaving.edges.values()].map((e) => ({ e, leaving: true })));
    const pairCount = new Map<string, number>();
    const pairKey = (e: GraphEdge) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`);
    for (const { e } of all) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
    const pairSeen = new Map<string, number>();
    return all.map(({ e, leaving: isLeaving }) => {
      const pk = pairKey(e);
      const idx = pairSeen.get(pk) ?? 0;
      pairSeen.set(pk, idx + 1);
      const marker: EdgeMarker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.kind === "linkTable" ? "#d9822b" : "#7a8ca3" };
      return {
        id: e.key, source: e.source, target: e.target, type: "relationship", markerEnd: marker, selectable: false,
        data: {
          edge: e, parallelIndex: idx, parallelCount: pairCount.get(pk)!, leaving: isLeaving,
          highlighted: focus !== undefined && (e.source === focus || e.target === focus), isSelected: e.key === selectedEdge,
          onLabelClick: isLeaving ? undefined : () => clickEdge(e.key),
        },
      };
    });
  }, [graph, leaving, focus, selectedEdge, clickEdge]);

  const onNodesChange = useCallback((changes: NodeChange<InstanceFlowNode>[]) => {
    let moved = false;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions)
        measured.current.set(c.id, c.dimensions);
      else if (c.type === "position" && c.position) {
        animator.setPosition(c.id, c.position);
        moved = true;
      }
      if (c.type === "position" && c.dragging === false) {
        // A dragged pin keeps its new place relative to the centre.
        const { pins: current, graph: g } = useGraphStore.getState();
        const p = animator.current.get(c.id);
        const centre = animator.current.get(g.centreKey);
        if (current.has(c.id) && c.id !== g.centreKey && p && centre)
          graphActions.setPinOffset(c.id, { x: p.x - centre.x, y: p.y - centre.y });
      }
    }
    if (moved) setPositions(animator.current);
  }, [animator]);

  const onNodeClick = useCallback((ev: React.MouseEvent, n: InstanceFlowNode) => {
    if (tool !== "navigate") {
      setFeedback(n.data.leaving
        ? { kind: "invalid", message: "This target is leaving the graph." }
        : applyGraphTool(tool, { kind: "node", key: n.id }));
      return;
    }
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) graphActions.select({ kind: "node", key: n.id });
    else void graphActions.activate(n.id);
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape" && !e.defaultPrevented) changeTool("navigate");
      else if (e.altKey && e.key === "ArrowLeft") graphActions.back();
      else if (e.altKey && e.key === "ArrowRight") graphActions.forward();
      else if (e.key === "f" && !e.metaKey && !e.ctrlKey) graphActions.requestFit();
      else if (e.key === "p" && !e.metaKey && !e.ctrlKey) {
        const sel = useGraphStore.getState().selection;
        if (sel?.kind === "node") graphActions.togglePin(sel.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeTool]);

  return (
    <div className={`ig-canvas${tool !== "navigate" ? " ig-canvas--tool-active" : ""}`}>
      <ReactFlow<InstanceFlowNode, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={(_, e) => {
          if (!e.data?.leaving) clickEdge(e.id);
          else if (tool !== "navigate") setFeedback({ kind: "invalid", message: "This target is leaving the graph." });
        }}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(undefined)}
        onPaneClick={() => { if (tool === "navigate") graphActions.select(undefined); }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        maxZoom={2.5}
        onlyRenderVisibleElements={nodes.length > 300}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.data as InstanceFlowNode["data"]).color} nodeStrokeWidth={0} />
        <GraphToolbar tool={tool} onToolChange={changeTool} feedback={feedback} />
      </ReactFlow>
      {graph.nodes.size === 0 && <GraphEmptyState />}
    </div>
  );
}

function GraphEmptyState() {
  const engine = useGraphStore((s) => s.engine);
  return (
    <div className="ig-empty">
      <div className="ig-empty__title">No instance selected</div>
      <div>{engine ? "Run an ECSQL query in the Seed panel and pick a row, or click an element in the 3D view." : "Opening iModel…"}</div>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
