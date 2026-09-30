/** SVG rendering of the stream stack: click a band to select the op, hover for a tooltip. */
import * as React from "react";
import type { StreamOpKind } from "../engine/geometryStream";
import { layoutStreamStack, type StackOpInput } from "./streamStackLayout";

export const KIND_COLORS: Record<StreamOpKind, string> = {
  header: "#8d96a8",
  appearance: "#b88ae8",
  styleMod: "#b88ae8",
  fill: "#e8a04a",
  pattern: "#e8a04a",
  material: "#e8a04a",
  subRange: "#5a6478",
  partReference: "#4ba7e8",
  textString: "#53c7a2",
  image: "#53c7a2",
  brep: "#e86a6a",
  geometry: "#6f9ff3",
  unknown: "#e04f4f",
};

const WIDTH = 220;
const RAIL_W = 6;
const INDENT = 16;

export interface StreamStackProps {
  readonly ops: readonly StackOpInput[];
  readonly selected?: { streamId: string; index: number };
  readonly onSelect: (streamId: string, index: number) => void;
}

export function StreamStack({ ops, selected, onSelect }: StreamStackProps): React.JSX.Element {
  const layout = React.useMemo(() => layoutStreamStack(ops), [ops]);
  if (layout.bands.length === 0) return <></>;
  return (
    <svg
      className="ig-stream-stack"
      width="100%"
      viewBox={`0 0 ${WIDTH} ${layout.height}`}
      style={{ maxWidth: WIDTH, display: "block" }}
      role="img"
      aria-label="Geometry stream stack"
    >
      {layout.runs.map((run, i) => (
        <rect key={`run-${i}`} x={0} y={run.y} width={RAIL_W} height={run.height} rx={1} fill={run.color ?? "#8d96a8"}>
          <title>{`Sub-category ${run.subCategoryId}${run.color ? ` · ${run.color}` : ""}`}</title>
        </rect>
      ))}
      {layout.bands.map((band) => {
        const isSelected = selected !== undefined && selected.streamId === band.streamId && selected.index === band.index;
        const x = RAIL_W + 4 + band.depth * INDENT;
        return (
          <g key={`${band.streamId}:${band.index}`} onClick={() => onSelect(band.streamId, band.index)} style={{ cursor: "pointer" }}>
            <rect
              x={x}
              y={band.y}
              width={WIDTH - x}
              height={band.height}
              rx={2}
              fill={KIND_COLORS[band.kind]}
              opacity={band.kind === "subRange" || band.kind === "header" ? 0.45 : 0.85}
              stroke={isSelected ? "var(--iui-color-border-accent, #fff)" : "none"}
              strokeWidth={isSelected ? 2 : 0}
            />
            {band.height >= 14 && (
              <text x={x + 6} y={band.y + band.height / 2 + 3.5} fontSize={10} fill="#fff" pointerEvents="none">
                {band.label.length > 30 ? `${band.label.slice(0, 29)}…` : band.label}
              </text>
            )}
            <title>{`#${band.index} ${band.label}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
