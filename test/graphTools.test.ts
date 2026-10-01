import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS } from "../src/frontend/engine/GraphEngine";
import { emptyGraph, type GraphNode } from "../src/frontend/engine/GraphModel";
import { EMPTY_FILTERS } from "../src/frontend/engine/filters";
import { applyGraphTool, type GraphTool } from "../src/frontend/graph/graphTools";
import { graphActions, useGraphStore } from "../src/frontend/state/graphStore";

const centre = "0x1:0x10";
const nodeKey = "0x1:0x11";
const edgeKey = "edge";
const aggregateKey = "aggregate";
const node: GraphNode = {
  key: nodeKey, id: "0x11", classId: "0x1", className: "Test:Thing", schemaName: "Test", label: "Thing",
  category: "other", classHierarchy: ["Test:Thing"], modelId: "0x2", modelName: "Plant", depth: 1, expanded: false,
};
const initialState = useGraphStore.getState();

beforeEach(() => {
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
  useGraphStore.setState({
    ...initialState,
    options: { ...DEFAULT_OPTIONS, filters: { ...EMPTY_FILTERS, schemas: { Test: "include" } } },
    selection: { kind: "node", key: centre },
    graph: {
      ...emptyGraph(centre),
      nodes: new Map([
        [centre, { ...node, key: centre, id: "0x10", depth: 0 }],
        [nodeKey, node],
        [aggregateKey, { ...node, key: aggregateKey, modelId: undefined,
          aggregate: { ownerKey: centre, relClassId: "0x3", relClassName: "Test:Rel", direction: "forward", hiddenCount: 12 } }],
      ]),
      edges: new Map([[edgeKey, { key: edgeKey, source: centre, target: nodeKey, relClassName: "Test:Rel", relClassId: "0x3", relInstanceId: "0x5", kind: "linkTable" }]]),
    },
  });
  useGraphStore.setState({ baseGraph: useGraphStore.getState().graph });
});

afterEach(() => { vi.unstubAllGlobals(); useGraphStore.setState(initialState, true); });

describe("graph click tools", () => {
  it.each([
    ["include-class", "classes", "Test:Thing", "include"],
    ["exclude-class", "classes", "Test:Thing", "exclude"],
    ["include-model", "models", "0x2", "include"],
    ["exclude-model", "models", "0x2", "exclude"],
    ["include-relationship", "relationships", "Test:Rel", "include"],
    ["exclude-relationship", "relationships", "Test:Rel", "exclude"],
  ] as const)("applies %s and preserves unrelated filters/selection", (tool, dimension, key, state) => {
    const target = dimension === "relationships" ? { kind: "edge" as const, key: edgeKey } : { kind: "node" as const, key: nodeKey };
    expect(applyGraphTool(tool, target).kind).toBe("applied");
    const filters = useGraphStore.getState().options.filters;
    expect(filters[dimension][key]).toEqual(dimension === "models" ? state : { state, polymorphic: false });
    expect(filters.schemas).toEqual({ Test: "include" });
    expect(useGraphStore.getState().selection).toEqual({ kind: "node", key: centre });
    const options = useGraphStore.getState().options;
    expect(applyGraphTool(tool, target).kind).toBe("unchanged");
    expect(useGraphStore.getState().options).toBe(options);
  });

  it("replaces subclass matching only for the targeted class entry", () => {
    useGraphStore.setState({ options: { ...DEFAULT_OPTIONS, filters: { ...EMPTY_FILTERS, classes: {
      "Test:Thing": { state: "exclude", polymorphic: true }, "Test:Other": { state: "include", polymorphic: true },
    } } } });
    applyGraphTool("exclude-class", { kind: "node", key: nodeKey });
    expect(useGraphStore.getState().options.filters.classes).toEqual({
      "Test:Thing": { state: "exclude", polymorphic: false }, "Test:Other": { state: "include", polymorphic: true },
    });
  });

  it("targets relationship groups without treating them as instances", () => {
    expect(applyGraphTool("include-relationship", { kind: "node", key: aggregateKey }).kind).toBe("applied");
    for (const tool of ["exclude-instance", "exclude-class", "include-model"] as const)
      expect(applyGraphTool(tool, { kind: "node", key: aggregateKey }).kind).toBe("invalid");
  });

  it("rejects incompatible, stale, and missing-model targets without mutations", () => {
    const options = useGraphStore.getState().options;
    for (const tool of ["include-class", "exclude-class", "include-model", "exclude-model", "exclude-instance"] satisfies GraphTool[])
      expect(applyGraphTool(tool, { kind: "edge", key: edgeKey }).kind).toBe("invalid");
    expect(applyGraphTool("exclude-relationship", { kind: "node", key: nodeKey }).kind).toBe("invalid");
    expect(applyGraphTool("exclude-instance", { kind: "node", key: "gone" }).kind).toBe("invalid");
    useGraphStore.setState({ graph: { ...useGraphStore.getState().graph, nodes: new Map([[nodeKey, { ...node, modelId: undefined }]]) } });
    expect(applyGraphTool("include-model", { kind: "node", key: nodeKey }).message).toContain("no containing model");
    expect(useGraphStore.getState().options).toBe(options);
  });

  it("excludes only the clicked instance and protects the centre", () => {
    expect(applyGraphTool("exclude-instance", { kind: "node", key: centre }).message).toContain("centre cannot");
    expect(useGraphStore.getState().options.excludedInstances).toEqual([]);
    expect(applyGraphTool("exclude-instance", { kind: "node", key: nodeKey }).kind).toBe("applied");
    expect(useGraphStore.getState().options.excludedInstances).toEqual([nodeKey]);
    expect(useGraphStore.getState().options.filters.classes).toEqual({});
    expect(applyGraphTool("exclude-class", { kind: "node", key: centre }).message).toContain("centre remains visible");
    expect(() => graphActions.excludeInstance(centre)).toThrow("centre cannot");
  });
});
