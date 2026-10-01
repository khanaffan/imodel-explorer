import { describe, expect, it } from "vitest";
import { matchesShortcut } from "../src/frontend/commands/registry";
import { EMPTY_FILTERS, filterCount } from "../src/frontend/engine/filters";
import { iModelPathProblem } from "../src/common/iModelFiles";

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
