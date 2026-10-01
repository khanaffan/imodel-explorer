import { Handle, type Node, type NodeProps, Position, useStore } from "@xyflow/react";
import { memo, useCallback, useState } from "react";
import type { GraphNode } from "../engine/GraphModel";
import { loadInstanceProperties, type PropertyRecord } from "../engine/instanceProperties";
import { graphActions, useGraphStore } from "../state/graphStore";
import { contrastText } from "../state/colorTheme";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export interface InstanceNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly color: string;
  readonly isCentre: boolean;
  readonly isSelected: boolean;
  readonly isPinned: boolean;
  readonly leaving: boolean;
  /** Stagger for the entrance animation, by ring. */
  readonly enterDelayMs: number;
  /** Find-in-graph state; undefined when not searching. */
  readonly find?: "current" | "match" | "dimmed";
}

export type InstanceFlowNode = Node<InstanceNodeData, "instance">;

const COMPACT_ZOOM = 0.45;
const PREVIEW_COUNT = 8;
const zoomIsCompact = (s: { transform: [number, number, number] }) => s.transform[2] < COMPACT_ZOOM;

function shortClass(fullName: string) {
  return fullName.split(":")[1] ?? fullName;
}

const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, left: "50%", top: "50%", pointerEvents: "none" } as const;

function InstanceNodeView({ data }: NodeProps<InstanceFlowNode>) {
  const { node, color, isCentre, isSelected, isPinned, leaving, enterDelayMs, find } = data;
  const compact = useStore(zoomIsCompact);
  const [preview, setPreview] = useState<PropertyRecord[] | "loading" | undefined>();

  const togglePreview = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (preview) { setPreview(undefined); return; }
    const engine = useGraphStore.getState().engine;
    if (!engine) return;
    setPreview("loading");
    try {
      const props = await loadInstanceProperties(engine.port, engine.registry, node.className, node.id);
      setPreview(props.filter((p) => p.kind !== "system" && p.value !== "").slice(0, PREVIEW_COUNT));
    } catch {
      setPreview([]);
    }
  }, [preview, node.className, node.id]);

  const onExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.expanded) graphActions.collapse(node.key);
    else void graphActions.expand(node.key);
  }, [node.expanded, node.key]);

  const onPin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    graphActions.togglePin(node.key);
  }, [node.key]);

  const classes = ["ig-node", isCentre && "ig-node--centre", isSelected && "ig-node--selected", isPinned && "ig-node--pinned", leaving && "ig-node--leaving",
    node.aggregate && "ig-node--aggregate", compact && "ig-node--compact", preview && "ig-node--open", find && `ig-node--find-${find}`].filter(Boolean).join(" ");

  const handles = (
    <>
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />
    </>
  );

  if (node.aggregate) {
    return (
      <div className={classes} style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT - 16, animationDelay: `${enterDelayMs}ms` }}
        title={`Click to load ${node.aggregate.hiddenCount} more through ${node.aggregate.relClassName}`}>
        {handles}
        <div className="ig-node__agg-count">+{node.aggregate.hiddenCount}</div>
        <div className="ig-node__agg-rel">{shortClass(node.aggregate.relClassName)} · {node.aggregate.direction}</div>
      </div>
    );
  }

  return (
    <div className={classes} style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT, borderColor: color, animationDelay: `${enterDelayMs}ms` }}
      title={`${node.className}\n${node.id}${node.modelName ? `\nModel: ${node.modelName}` : ""}`}>
      {handles}
      <div className="ig-node__header" style={{ background: color, color: contrastText(color) }}>
        {isPinned && <span className="ig-node__pin-badge" title="Pinned: stays in view while related to the centre or another pin">📌</span>}
        <span className="ig-node__class">{shortClass(node.className)}</span>
        {!compact && <span className="ig-node__schema">{node.schemaName}</span>}
      </div>
      {!compact && (
        <div className="ig-node__body">
          <div className="ig-node__label">{node.label}</div>
          <div className="ig-node__meta">
            <span className="ig-node__id">{node.id}</span>
            {node.modelName && <span className="ig-node__model" title={`Model ${node.modelId}`}>{node.modelName}</span>}
          </div>
          {preview && (
            <div className="ig-node__preview">
              {preview === "loading" ? <div className="ig-node__muted">Loading…</div>
                : preview.length === 0 ? <div className="ig-node__muted">No populated properties</div>
                  : preview.map((p) => (
                    <div key={p.name} className="ig-node__prop"><span>{p.label}</span><span title={p.value}>{p.value}</span></div>
                  ))}
            </div>
          )}
        </div>
      )}
      {!compact && !leaving && (
        <div className="ig-node__actions">
          <button className={`ig-node__btn ig-node__btn--pin${isPinned ? " ig-node__btn--on" : ""}`} onClick={onPin} aria-pressed={isPinned}
            title={isPinned ? "Unpin" : "Pin: keep in view while you click through the graph (P)"}>📌</button>
          <button className="ig-node__btn" onClick={togglePreview} title={preview ? "Hide properties" : "Show properties"}>{preview ? "▴" : "▾"}</button>
          {!isCentre && (
            <button className="ig-node__btn" onClick={onExpand} title={node.expanded ? "Collapse" : "Expand one hop here"}>{node.expanded ? "−" : "+"}</button>
          )}
        </div>
      )}
    </div>
  );
}

export const InstanceNode = memo(InstanceNodeView);
