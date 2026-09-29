import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, passesModelFilters } from "../src/frontend/engine/filters";
import { buildModelTree, type ModelInfo } from "../src/frontend/engine/models";

const m = (id: string, parentId?: string): ModelInfo => ({ id, name: id, className: "BisCore:PhysicalModel", parentId });
// repo ─┬─ a ── a1 ── a11
//       └─ b
const models = [m("repo"), m("a", "repo"), m("a1", "a"), m("a11", "a1"), m("b", "repo")];
const parents = new Map(models.map((x) => [x.id, x.parentId]));
const parentOf = (id: string) => parents.get(id);
const passes = (modelId: string, states: Record<string, "include" | "exclude">) =>
  passesModelFilters({ ...EMPTY_FILTERS, models: states }, { modelId }, parentOf);

describe("buildModelTree", () => {
  it("nests sub-models under their parents", () => {
    const [root] = buildModelTree(models);
    expect(root.model.id).toBe("repo");
    expect(root.children.map((c) => c.model.id).sort()).toEqual(["a", "b"]);
    expect(root.children.find((c) => c.model.id === "a")?.children[0].children[0].model.id).toBe("a11");
  });

  it("treats models with unknown parents as roots and survives cycles", () => {
    const roots = buildModelTree([m("x", "missing"), m("p", "q"), m("q", "p")]);
    expect(roots.map((r) => r.model.id).sort()).toEqual(["p", "q", "x"]);
  });
});

describe("hierarchical model filter", () => {
  it("lets sub-models inherit an exclude", () => {
    expect(passes("a11", { a: "exclude" })).toBe(false);
    expect(passes("b", { a: "exclude" })).toBe(true);
  });

  it("lets sub-models inherit an include", () => {
    expect(passes("a11", { a: "include" })).toBe(true);
    expect(passes("b", { a: "include" })).toBe(false);
  });

  it("lets the nearest explicit state win", () => {
    expect(passes("a11", { a: "exclude", a1: "include" })).toBe(true);
    expect(passes("a11", { repo: "include", a1: "exclude" })).toBe(false);
  });

  it("ignores instances outside any model and tolerates parent cycles", () => {
    expect(passesModelFilters({ ...EMPTY_FILTERS, models: { a: "exclude" } }, {}, parentOf)).toBe(true);
    const cyclic = new Map([["p", "q"], ["q", "p"]]);
    expect(passesModelFilters({ ...EMPTY_FILTERS, models: { z: "include" } }, { modelId: "p" }, (id) => cyclic.get(id))).toBe(false);
  });
});
