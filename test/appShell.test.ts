import { describe, expect, it } from "vitest";
import { matchesShortcut } from "../src/frontend/commands/registry";
import { EMPTY_FILTERS, filterCount } from "../src/frontend/engine/filters";
import { iModelPathProblem } from "../src/common/iModelFiles";
import { formatBytes, summarizeAppMemory } from "../src/common/appMemory";

describe("iModelPathProblem", () => {
  it("accepts iModel extensions in any case on either path style", () => {
    expect(iModelPathProblem("/data/plant.bim")).toBeUndefined();
    expect(iModelPathProblem("C:\\data\\Plant.IBIM")).toBeUndefined();
    expect(iModelPathProblem("/data/x.imodel")).toBeUndefined();
  });
  it("rejects other files, extensionless names and empty paths by name", () => {
    expect(iModelPathProblem("/data/package.json")).toMatch(/^package\.json is not an iModel \(expected \.bim, \.ibim, \.imodel\)/);
    expect(iModelPathProblem("/data.bim/readme")).toMatch(/^readme is not an iModel/);
    expect(iModelPathProblem("")).toBe("No file was given.");
  });
});

describe("filterCount", () => {
  it("counts entries across every dimension", () => {
    expect(filterCount(EMPTY_FILTERS)).toBe(0);
    expect(filterCount({
      models: { "0x1": "exclude" }, schemas: { BisCore: "exclude" },
      classes: { "A:B": { state: "include", polymorphic: true } }, relationships: { "A:R": { state: "exclude", polymorphic: false } },
    })).toBe(4);
  });
});

describe("symbol shortcuts", () => {
  it("match '?' whether or not the layout needs Shift, but not with ⌘", () => {
    const ev = (shiftKey: boolean, metaKey = false) => ({ key: "?", shiftKey, metaKey, ctrlKey: false, altKey: false });
    expect(matchesShortcut({ key: "?" }, ev(true), true)).toBe(true);
    expect(matchesShortcut({ key: "?" }, ev(false), true)).toBe(true);
    expect(matchesShortcut({ key: "?" }, ev(true, true), true)).toBe(false);
  });
});

describe("app memory", () => {
  it("sums every process in kilobytes and groups them by type in a fixed order", () => {
    const m = summarizeAppMemory([
      { type: "Tab", memory: { workingSetSize: 2048 } },
      { type: "Browser", memory: { workingSetSize: 1024 } },
      { type: "Utility", memory: { workingSetSize: 512 } },
      { type: "GPU", memory: { workingSetSize: 256 } },
      { type: "Zygote", memory: { workingSetSize: 512 } },
      { type: "Tab", memory: { workingSetSize: Number.NaN } },
    ]);
    expect(m.groups).toEqual([
      { label: "Main & iModel backend", bytes: 1024 * 1024 },
      { label: "Window", bytes: 2048 * 1024 },
      { label: "GPU", bytes: 256 * 1024 },
      { label: "Other", bytes: 1024 * 1024 },
    ]);
    expect(m.totalBytes).toBe((1024 + 2048 + 256 + 1024) * 1024);
    expect(summarizeAppMemory([])).toEqual({ totalBytes: 0, groups: [] });
  });

  it("formats as MB below a gigabyte and GB above", () => {
    expect(formatBytes(612.4 * 1024 * 1024)).toBe("612 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});
