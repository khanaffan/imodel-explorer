import { Range3d } from "@itwin/core-geometry";
import { describe, expect, it } from "vitest";
import { type Box, robustRange, shouldRefit } from "../src/frontend/content/robustExtents";

const box = (x: number, y: number, s = 1): Box => [x, y, 0, x + s, y + s, s];

describe("robustRange", () => {
  it("ignores a few stray elements far from the site", () => {
    const site = Array.from({ length: 1000 }, (_, i) => box(440000 + (i % 50), 280000 + Math.floor(i / 50)));
    const range = robustRange([...site, box(0, 0), box(890000, 0), box(0, 560000)])!;
    expect(range.low.x).toBeGreaterThanOrEqual(440000);
    expect(range.high.y).toBeLessThanOrEqual(280021);
    expect(shouldRefit(Range3d.createXYZXYZ(0, 0, 0, 890000, 560000, 1).diagonal().magnitude(), range)).toBe(true);
  });

  it("keeps the project extents when geometry fills them", () => {
    const boxes = Array.from({ length: 100 }, (_, i) => box(i, i));
    const range = robustRange(boxes);
    expect(shouldRefit(Range3d.createXYZXYZ(0, 0, 0, 100, 100, 1).diagonal().magnitude(), range)).toBe(false);
  });

  it("returns undefined for no usable boxes", () => {
    expect(robustRange([])).toBeUndefined();
    expect(robustRange([[NaN, 0, 0, 1, 1, 1]])).toBeUndefined();
    expect(shouldRefit(1, undefined)).toBe(false);
    expect(shouldRefit(0, robustRange([box(0, 0)]))).toBe(false);
  });
});
