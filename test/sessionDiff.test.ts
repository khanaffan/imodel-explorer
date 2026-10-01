import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GraphData, GraphEdge, GraphNode, NodeCategory } from "../src/frontend/engine/GraphModel";
import { nodeKeyString } from "../src/frontend/engine/GraphModel";
import { diffGraphs } from "../src/frontend/engine/sessionDiff";
import { replaySession } from "../src/frontend/engine/sessionReplay";
import { captureSession } from "../src/frontend/services/sessionStore";
import { createFixture, type Fixture } from "./fixture";

function node(key: string, aggregate = false): GraphNode {
  const [classId, id] = key.split(":");
  return {
    key, id, classId, className: "T:X", schemaName: "T", label: key, category: "other" as NodeCategory, classHierarchy: ["T:X"], depth: 1, expanded: true,
    ...(aggregate ? { aggregate: { ownerKey: "0x1:0x1", relClassName: "T:R", direction: "forward", hiddenCount: 3 } } : {}),
  } as GraphNode;
}
const edge = (a: string, b: string): GraphEdge => ({ key: `${a}>${b}`, source: a, target: b, relClassId: "0x9", relClassName: "T:R", relInstanceId: "0x1", kind: "navigation" });
const graph = (centre: string, keys: string[], edges: Array<[string, string]>, aggregates: string[] = []): GraphData => ({
  centreKey: centre,
  nodes: new Map([...keys.map((k) => [k, node(k)] as const), ...aggregates.map((k) => [k, node(k, true)] as const)]),
  edges: new Map(edges.map(([a, b]) => [`${a}>${b}`, edge(a, b)])),
  truncated: false,
});

describe("diffGraphs", () => {
  const C = "0x1:0x1", A = "0x1:0x2", B = "0x1:0x3", D = "0x1:0x4", AGG = "agg:1";

  it("classifies nodes and edges by key and keeps removed nodes, collapsed, in the union", () => {
    const before = graph(C, [C, A, B], [[C, A], [C, B]], [AGG]);
    const after = graph(C, [C, A, D], [[C, A], [A, D]]);
    const d = diffGraphs(before, after);
    expect(Object.fromEntries(d.nodes)).toEqual({ [C]: "same", [A]: "same", [D]: "added", [B]: "removed" });
    expect(Object.fromEntries(d.edges)).toEqual({ [`${C}>${A}`]: "same", [`${A}>${D}`]: "added", [`${C}>${B}`]: "removed" });
    expect(d.counts.nodes).toEqual({ added: 1, removed: 1, same: 2 });
    expect(d.graph.centreKey).toBe(C);
    expect(d.graph.nodes.has(AGG)).toBe(false);
    expect(d.graph.nodes.get(B)!.expanded).toBe(false);
  });

  it("reports no change for identical graphs", () => {
    const g = graph(C, [C, A], [[C, A]]);
    expect(diffGraphs(g, g).counts).toEqual({ nodes: { added: 0, removed: 0, same: 2 }, edges: { added: 0, removed: 0, same: 1 } });
  });
});

describe("session diff in the store", () => {
  let fx: Fixture;
  let store: typeof import("../src/frontend/state/graphStore");
  const state = () => store.useGraphStore.getState();
  const nk = (cls: string, id: string) => ({ classId: fx.classIds[cls], id });
  const idle = async () => vi.waitFor(() => {
    if (state().status.kind === "error") throw new Error(state().status.message);
    expect(state().status.kind).toBe("idle");
  });

  beforeAll(async () => {
    fx = await createFixture();
    const mem = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    store = await import("../src/frontend/state/graphStore");
    await store.graphActions.attach(fx.db as never, "fixture.bim", "fallback");
  });
  afterAll(async () => fx?.close());

  const capture = (name: string) => captureSession(name, "fixture.bim", state().graph, state().options, "radial", state().pins)!;

  it("rebuilds sessions with the same replay as restore, shows the difference, and exits back", async () => {
    const { graphActions } = store;
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    graphActions.setOptions({ depth: 1 });
    await idle();
    const shallow = capture("shallow");
    graphActions.setOptions({ depth: 2 });
    await idle();
    const deep = capture("deep");
    const deepKeys = [...state().graph.nodes.keys()].sort();

    // Headless replay matches what restoring shows.
    const replayed = await replaySession(state().engine!, deep, state().options, { cancelled: false });
    expect([...replayed.base.nodes.keys()].sort()).toEqual(deepKeys);

    const shownBefore = state().graph;
    const crumbsBefore = state().crumbs;
    const diff = (await graphActions.diffSessions(shallow, deep))!;
    expect(diff.counts.nodes.removed).toBe(0);
    expect(diff.counts.nodes.added).toBeGreaterThan(0);
    expect(diff.counts.nodes.added + diff.counts.nodes.same).toBe(deepKeys.filter((k) => !shownBefore.nodes.get(k)?.aggregate).length);
    expect(state().diffView?.label).toBe("shallow → deep");
    expect(state().graph).toBe(diff.graph);
    expect(state().crumbs).toBe(crumbsBefore); // the comparison is not a history entry

    graphActions.exitDiff();
    expect(state().diffView).toBeUndefined();
    expect([...state().graph.nodes.keys()].sort()).toEqual([...shownBefore.nodes.keys()].sort());
  });

  it("compares the current graph with a session, and any graph edit ends the comparison", async () => {
    const { graphActions } = store;
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    graphActions.setOptions({ depth: 1 });
    await idle();
    const saved = capture("before exclusion");
    const pipeA = nodeKeyString(nk("TestIG:Pipe", fx.ids.pipeA));
    expect(state().graph.nodes.has(pipeA)).toBe(true);
    graphActions.excludeInstance(pipeA);
    await idle();
    const diff = (await graphActions.diffSessions("current", saved))!;
    expect(diff.nodes.get(pipeA)).toBe("added");

    graphActions.collapse(state().graph.centreKey);
    expect(state().diffView).toBeUndefined();
    graphActions.removeInstanceExclusion(pipeA);
    await idle();
  });

  it("rejects a session that excludes its own centre without touching the graph", async () => {
    const { graphActions } = store;
    const before = state().graph;
    const bad = { ...capture("bad"), excludedInstances: [nodeKeyString(nk("TestIG:Pump", fx.ids.pump1))] };
    await expect(graphActions.diffSessions("current", bad)).rejects.toThrow(/excludes its own centre/);
    expect(state().diffView).toBeUndefined();
    expect(state().graph).toBe(before);
  });
});
