import { describe, expect, it } from "vitest";
import {
  BAND_GAP, DOWNSAMPLE_THRESHOLD, layoutStreamStack, PRIMITIVE_BAND, type StackOpInput, STATE_BAND,
} from "../src/frontend/widgets/streamStackLayout";

function op(partial: Partial<StackOpInput> & Pick<StackOpInput, "index" | "kind" | "isPrimitive">): StackOpInput {
  return { label: partial.kind, depth: 0, streamId: "", ...partial };
}

describe("layoutStreamStack", () => {
  it("gives primitives tall bands and state ops thin ones", () => {
    const layout = layoutStreamStack([
      op({ index: 0, kind: "header", isPrimitive: false }),
      op({ index: 1, kind: "appearance", isPrimitive: false }),
      op({ index: 2, kind: "geometry", isPrimitive: true }),
    ]);
    expect(layout.bands).toHaveLength(3);
    expect(layout.bands[0].height).toBe(STATE_BAND);
    expect(layout.bands[2].height).toBe(PRIMITIVE_BAND);
    expect(layout.bands[1].y).toBe(STATE_BAND + BAND_GAP);
    expect(layout.height).toBe(STATE_BAND * 2 + PRIMITIVE_BAND + BAND_GAP * 2);
  });

  it("keeps nesting depth on bands", () => {
    const layout = layoutStreamStack([
      op({ index: 0, kind: "partReference", isPrimitive: true }),
      op({ index: 0, kind: "geometry", isPrimitive: true, depth: 1, streamId: "0x42" }),
    ]);
    expect(layout.bands[1].depth).toBe(1);
    expect(layout.bands[1].streamId).toBe("0x42");
  });

  it("merges consecutive ops sharing sub-category and colour into one run", () => {
    const layout = layoutStreamStack([
      op({ index: 0, kind: "geometry", isPrimitive: true, subCategoryId: "0x11", color: "#ff0000" }),
      op({ index: 1, kind: "geometry", isPrimitive: true, subCategoryId: "0x11", color: "#ff0000" }),
      op({ index: 2, kind: "geometry", isPrimitive: true, subCategoryId: "0x11", color: "#00ff00" }),
      op({ index: 3, kind: "geometry", isPrimitive: true, subCategoryId: "0x12", color: "#00ff00" }),
    ]);
    expect(layout.runs).toHaveLength(3);
    expect(layout.runs[0].height).toBeGreaterThan(layout.runs[1].height);
    expect(layout.runs[0].y).toBe(0);
  });

  it("does not break a run on state ops between primitives", () => {
    const layout = layoutStreamStack([
      op({ index: 0, kind: "geometry", isPrimitive: true, subCategoryId: "0x11", color: "#ff0000" }),
      op({ index: 1, kind: "subRange", isPrimitive: false }),
      op({ index: 2, kind: "geometry", isPrimitive: true, subCategoryId: "0x11", color: "#ff0000" }),
    ]);
    expect(layout.runs).toHaveLength(1);
  });

  it("downsamples very long streams to a bounded height", () => {
    const many: StackOpInput[] = [];
    for (let i = 0; i < DOWNSAMPLE_THRESHOLD * 2; i++)
      many.push(op({ index: i, kind: "geometry", isPrimitive: true }));
    const layout = layoutStreamStack(many);
    expect(layout.height).toBeLessThanOrEqual(600);
    expect(layout.bands).toHaveLength(DOWNSAMPLE_THRESHOLD * 2);
    // Bands stay in order and non-overlapping.
    for (let i = 1; i < layout.bands.length; i++)
      expect(layout.bands[i].y).toBeGreaterThanOrEqual(layout.bands[i - 1].y + layout.bands[i - 1].height);
  });

  it("handles an empty stream", () => {
    const layout = layoutStreamStack([]);
    expect(layout.bands).toHaveLength(0);
    expect(layout.runs).toHaveLength(0);
    expect(layout.height).toBe(0);
  });
});
