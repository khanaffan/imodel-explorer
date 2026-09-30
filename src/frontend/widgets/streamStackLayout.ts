/** Pure layout for the stream stack: the geometry stream drawn as an ordered column of bands, with
 * a rail of merged symbology runs down the left edge. No React, unit-testable. */
import type { StreamOp, StreamOpKind } from "../engine/geometryStream";

export interface StackOpInput {
  /** Raw index of the op (unique across nesting levels only within one stream). */
  readonly index: number;
  readonly kind: StreamOpKind;
  readonly label: string;
  readonly isPrimitive: boolean;
  /** Nesting depth: 0 for the element stream, 1 for ops inside an expanded part. */
  readonly depth: number;
  readonly subCategoryId?: string;
  readonly color?: string;
  /** Identifies which stream the op belongs to ("" for the element, part id for a part). */
  readonly streamId: string;
}

export interface StackBand {
  readonly index: number;
  readonly streamId: string;
  readonly kind: StreamOpKind;
  readonly depth: number;
  readonly y: number;
  readonly height: number;
  readonly label: string;
}

/** A run of consecutive ops sharing sub-category + colour, drawn as a rail on the left. */
export interface StackRun {
  readonly subCategoryId: string;
  readonly color?: string;
  readonly y: number;
  readonly height: number;
}

export interface StackLayout {
  readonly bands: StackBand[];
  readonly runs: StackRun[];
  readonly height: number;
}

export const PRIMITIVE_BAND = 22;
export const STATE_BAND = 8;
export const BAND_GAP = 2;
/** Above this many ops the stack compresses to a fixed height. */
export const DOWNSAMPLE_THRESHOLD = 300;
const MAX_HEIGHT = 600;

/** Flattens ops (element stream plus any expanded parts inline after their reference op). */
export function stackInput(ops: readonly StreamOp[], expanded?: ReadonlyMap<string, readonly StreamOp[]>): StackOpInput[] {
  const out: StackOpInput[] = [];
  for (const op of ops) {
    out.push({
      index: op.index, kind: op.kind, label: op.label, isPrimitive: op.isPrimitive, depth: 0,
      subCategoryId: op.appearance?.subCategoryId, color: op.appearance?.color, streamId: "",
    });
    const part = op.partId !== undefined ? expanded?.get(op.partId) : undefined;
    if (part)
      for (const p of part)
        out.push({
          index: p.index, kind: p.kind, label: p.label, isPrimitive: p.isPrimitive, depth: 1,
          subCategoryId: p.appearance?.subCategoryId ?? op.appearance?.subCategoryId,
          color: p.appearance?.color ?? op.appearance?.color, streamId: op.partId!,
        });
  }
  return out;
}

export function layoutStreamStack(ops: readonly StackOpInput[]): StackLayout {
  const natural = ops.reduce((h, op) => h + (op.isPrimitive ? PRIMITIVE_BAND : STATE_BAND) + BAND_GAP, 0);
  const scale = ops.length > DOWNSAMPLE_THRESHOLD && natural > MAX_HEIGHT ? MAX_HEIGHT / natural : 1;
  const gap = BAND_GAP * scale;

  const bands: StackBand[] = [];
  const runs: StackRun[] = [];
  let y = 0;
  let run: { subCategoryId: string; color?: string; y: number } | undefined;

  const flushRun = (end: number) => {
    if (run && end > run.y) runs.push({ ...run, height: end - run.y });
    run = undefined;
  };

  for (const op of ops) {
    const height = (op.isPrimitive ? PRIMITIVE_BAND : STATE_BAND) * scale;
    bands.push({ index: op.index, streamId: op.streamId, kind: op.kind, depth: op.depth, y, height, label: op.label });
    if (op.subCategoryId !== undefined) {
      if (!run || run.subCategoryId !== op.subCategoryId || run.color !== op.color) {
        flushRun(y);
        run = { subCategoryId: op.subCategoryId, color: op.color, y };
      }
    } else if (!op.isPrimitive && run) {
      // State ops between primitives of the same run do not break it.
    }
    y += height + gap;
  }
  flushRun(y - gap);
  return { bands, runs, height: Math.max(y - gap, 0) };
}
