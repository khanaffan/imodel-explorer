import { describe, expect, it } from "vitest";
import type { Census } from "../src/frontend/engine/census";
import { censusToCsv, censusToMarkdown } from "../src/frontend/services/exporters";
import { layoutTreemap } from "../src/frontend/widgets/treemap";

const census: Census = {
  totalInstances: 40,
  entries: [
    { classId: "0x1", className: "TestIG:Pump", schemaName: "TestIG", category: "geometric3d", kind: "element", count: 3 },
    { classId: "0x2", className: 'TestIG:Odd,"Name', schemaName: "TestIG", category: "other", kind: "aspect", count: 37 },
  ],
  schemas: [{ schemaName: "TestIG", classesDefined: 5, classesUsed: 2, instances: 40 }],
};

describe("census export", () => {
  it("produces CSV with escaping", () => {
    const csv = censusToCsv(census);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("Schema,Class,Kind,Category,Count");
    expect(lines[1]).toBe("TestIG,TestIG:Pump,element,geometric3d,3");
    expect(lines[2]).toContain('"TestIG:Odd,""Name"');
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("produces Markdown with schema and class tables", () => {
    const md = censusToMarkdown(census);
    expect(md).toContain("Total instances: 40");
    expect(md).toContain("| TestIG | 2 | 5 | 40 |");
    expect(md).toContain("| TestIG:Pump | element | geometric3d | 3 |");
  });
});

describe("layoutTreemap", () => {
  it("tiles the whole box with proportional, non-overlapping rectangles", () => {
    const rects = layoutTreemap(
      [{ key: "a", value: 6 }, { key: "b", value: 6 }, { key: "c", value: 4 }, { key: "d", value: 3 }, { key: "e", value: 1 }],
      0, 0, 100, 60);
    expect(rects).toHaveLength(5);
    const area = rects.reduce((s, r) => s + r.width * r.height, 0);
    expect(area).toBeCloseTo(100 * 60, 3);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.width).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.height).toBeLessThanOrEqual(60 + 1e-6);
    }
    // Area proportional to value: a has 6/20 of the box.
    const a = rects.find((r) => r.key === "a")!;
    expect(a.width * a.height).toBeCloseTo(6000 * 6 / 20, 3);
    // No pairwise overlap.
    for (const p of rects) for (const q of rects) {
      if (p === q) continue;
      const overlapX = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x);
      const overlapY = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("skips non-positive values and handles empty input", () => {
    expect(layoutTreemap([], 0, 0, 10, 10)).toEqual([]);
    expect(layoutTreemap([{ key: "z", value: 0 }, { key: "n", value: -2 }], 0, 0, 10, 10)).toEqual([]);
    expect(layoutTreemap([{ key: "one", value: 5 }], 2, 3, 10, 10)).toEqual([
      { key: "one", x: 2, y: 3, width: 10, height: 10 },
    ]);
  });
});
