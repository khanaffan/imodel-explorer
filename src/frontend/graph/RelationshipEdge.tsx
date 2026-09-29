import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type InternalNode, useInternalNode, useStore } from "@xyflow/react";
import { memo } from "react";
import type { GraphEdge } from "../engine/GraphModel";

export interface RelationshipEdgeData extends Record<string, unknown> {
  readonly edge: GraphEdge;
  /** Position among parallel edges between the same two nodes, for fanning them apart. */
  readonly parallelIndex: number;
  readonly parallelCount: number;
  readonly highlighted: boolean;
  readonly isSelected: boolean;
  readonly leaving: boolean;
}

export type RelationshipFlowEdge = Edge<RelationshipEdgeData, "relationship">;

const LABEL_ZOOM = 0.75;
const PARALLEL_SPACING = 36;

interface Pt { x: number; y: number }

function centreOf(n: InternalNode): Pt {
  const { x, y } = n.internals.positionAbsolute;
  return { x: x + (n.measured.width ?? 0) / 2, y: y + (n.measured.height ?? 0) / 2 };
}

/** Where the segment from the node centre towards `toward` leaves the node's rectangle. */
function borderPoint(n: InternalNode, toward: Pt): Pt {
  const c = centreOf(n);
  const hw = (n.measured.width ?? 0) / 2 + 4;
  const hh = (n.measured.height ?? 0) / 2 + 4;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function shortName(fullName: string) {
  return fullName.split(":")[1] ?? fullName;
}

function RelationshipEdgeView({ id, source, target, data, markerEnd }: EdgeProps<RelationshipFlowEdge>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const zoomedIn = useStore((st) => st.transform[2] >= LABEL_ZOOM);
  if (!s || !t || !data) return null;

  const { edge, parallelIndex, parallelCount, highlighted, isSelected, leaving } = data;
  const sc = centreOf(s);
  const tc = centreOf(t);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const len = Math.hypot(dx, dy) || 1;
  // Parallel edges bow out on alternating sides; direction is normalised so A→B and B→A agree.
  const flip = source < target ? 1 : -1;
  const offset = (parallelIndex - (parallelCount - 1) / 2) * PARALLEL_SPACING * flip;
  const control = { x: (sc.x + tc.x) / 2 - (dy / len) * offset, y: (sc.y + tc.y) / 2 + (dx / len) * offset };
  const p1 = borderPoint(s, offset === 0 ? tc : control);
  const p2 = borderPoint(t, offset === 0 ? sc : control);
  const path = offset === 0 ? `M ${p1.x},${p1.y} L ${p2.x},${p2.y}` : `M ${p1.x},${p1.y} Q ${control.x},${control.y} ${p2.x},${p2.y}`;
  const at = (u: number) => offset === 0
    ? { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u }
    : { x: (1 - u) ** 2 * p1.x + 2 * (1 - u) * u * control.x + u * u * p2.x, y: (1 - u) ** 2 * p1.y + 2 * (1 - u) * u * control.y + u * u * p2.y };

  const showLabel = !leaving && (isSelected || highlighted || zoomedIn);
  const mid = at(0.5);
  const near = at(0.14);
  const far = at(0.86);
  const cls = `ig-edge ig-edge--${edge.kind}${highlighted ? " ig-edge--hl" : ""}${isSelected ? " ig-edge--selected" : ""}${leaving ? " ig-edge--leaving" : ""}`;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={cls} interactionWidth={14} />
      {showLabel && (
        <EdgeLabelRenderer>
          <div className={`ig-edge-label ig-edge-label--${edge.kind}${isSelected ? " ig-edge-label--selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
            title={`${edge.relClassName}${edge.navPropertyName ? ` (nav: ${edge.navPropertyName})` : " (link table)"}`}>
            {edge.kind === "navigation" ? "⟶ " : edge.kind === "linkTable" ? "⬌ " : ""}{shortName(edge.relClassName)}
            {edge.navPropertyName && <span className="ig-edge-label__nav">.{edge.navPropertyName}</span>}
          </div>
          {edge.cardinality && (
            <>
              <div className="ig-edge-card" style={{ transform: `translate(-50%, -50%) translate(${near.x}px, ${near.y}px)` }}>{edge.cardinality.source}</div>
              <div className="ig-edge-card" style={{ transform: `translate(-50%, -50%) translate(${far.x}px, ${far.y}px)` }}>{edge.cardinality.target}</div>
            </>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const RelationshipEdge = memo(RelationshipEdgeView);
