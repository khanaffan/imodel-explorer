import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import type { GraphData, GraphEdge, GraphNode, NodeCategory } from "../src/frontend/engine/GraphModel";
import { nodeKeyString } from "../src/frontend/engine/GraphModel";
import { composeDisplay, type Pin, prunePinEdges, retainPins } from "../src/frontend/engine/pins";
import { avoidPinned, NODE_HEIGHT, NODE_WIDTH, type Positions } from "../src/frontend/graph/layout";
import { captureSession, parseSession } from "../src/frontend/services/sessionStore";
import { createFixture, type Fixture } from "./fixture";

function node(key: string, depth = 1): GraphNode {
  const [classId, id] = key.split(":");
  return { key, id, classId, className: "T:X", schemaName: "T", label: key, category: "other" as NodeCategory, classHierarchy: ["T:X"], depth, expanded: false };
}
function edge(source: string, target: string): GraphEdge {
  return { key: `${source}>${target}`, source, target, relClassId: "0x9", relClassName: "T:R", relInstanceId: "0x1", kind: "navigation" };
}
function graph(centre: string, nodes: string[], edges: Array<[string, string]>): GraphData {
  return {
    centreKey: centre,
    nodes: new Map([centre, ...nodes].map((k, i) => [k, node(k, i === 0 ? 0 : 1)])),
    edges: new Map(edges.map(([a, b]) => [`${a}>${b}`, edge(a, b)])),
    truncated: false,
  };
}
const pins = (...keys: string[]) => new Map<string, Pin>(keys.map((k) => [k, { node: node(k) }]));
const edgeMap = (...pairs: Array<[string, string]>) => new Map(pairs.map(([a, b]) => [`${a}>${b}`, edge(a, b)]));

let fx: Fixture;
beforeAll(async () => { fx = await createFixture(); });
afterAll(async () => fx?.close());

const C = "0x1:0xc", N = "0x1:0xa", P = "0x1:0x1", Q = "0x1:0x2", R = "0x1:0x3";

describe("pin retention (chain rule)", () => {
  const base = graph(C, [N], [[C, N]]);

  it("keeps a pin linked directly to the centre", () => {
    expect([...retainPins(base, pins(P), edgeMap([P, C])).keys()]).toEqual([P]);
  });

  it("keeps a chain of pins that reaches the centre, and pins inside the traversal result", () => {
    const b = graph(C, [N, Q], [[C, N], [C, Q]]);
    expect([...retainPins(b, pins(P, Q, R), edgeMap([R, P], [P, Q])).keys()].sort()).toEqual([P, Q, R].sort());
  });

  it("drops a pin linked only to an ordinary graph node", () => {
    expect(retainPins(base, pins(P), edgeMap([P, N])).size).toBe(0);
  });

  it("drops pins linked only to each other, even though both are displayed", () => {
    const shown = composeDisplay(base, pins(P, Q), edgeMap([P, Q]));
    expect(shown.nodes.has(P) && shown.nodes.has(Q)).toBe(true);
    expect(retainPins(base, pins(P, Q), edgeMap([P, Q])).size).toBe(0);
  });

  it("composes the display without touching the traversal result, and prunes stale pin edges", () => {
    const shown = composeDisplay(base, pins(P), edgeMap([P, C], [Q, C]));
    expect(shown.nodes.has(P)).toBe(true);
    expect(shown.nodes.get(P)!.depth).toBe(2);
    expect(shown.edges.has(`${P}>${C}`)).toBe(true);
    expect(shown.edges.has(`${Q}>${C}`)).toBe(false); // Q is not displayed
    expect(base.nodes.has(P)).toBe(false);
    expect([...prunePinEdges(base, pins(P), edgeMap([P, C], [Q, C])).keys()]).toEqual([`${P}>${C}`]);
    expect(composeDisplay(base, new Map(), new Map())).toBe(base);
  });
});

describe("avoidPinned", () => {
  const overlapping = (p: Positions, a: string, b: string) =>
    Math.abs(p.get(a)!.x - p.get(b)!.x) < NODE_WIDTH && Math.abs(p.get(a)!.y - p.get(b)!.y) < NODE_HEIGHT;

  it("leaves unpinned layouts alone", () => {
    const p: Positions = new Map([[C, { x: 0, y: 0 }], [N, { x: 300, y: 0 }]]);
    expect(avoidPinned(p, new Set(), C)).toBe(p);
  });

  it("pushes nodes off a pin, never moves the centre, and moves a pin off the centre", () => {
    const p: Positions = new Map([
      [C, { x: 0, y: 0 }], [N, { x: 300, y: 0 }], [Q, { x: 600, y: 0 }], [R, { x: 0, y: 300 }],
      [P, { x: 310, y: 10 }], // pinned on top of N
      ["0x1:0x4", { x: 20, y: 20 }], // pinned on top of the centre
    ]);
    const out = avoidPinned(p, new Set([P, "0x1:0x4"]), C);
    expect(out.get(C)).toEqual({ x: 0, y: 0 });
    expect(out.get(P)).toEqual({ x: 310, y: 10 });
    expect(out.get(R)).toEqual({ x: 0, y: 300 });
    for (const [a, b] of [[N, P], [N, Q], ["0x1:0x4", C], [Q, P]]) expect(overlapping(out, a, b)).toBe(false);
    expect(out.get(N)!.x).toBeGreaterThan(300); // pushed outward along its ray
  });
});

describe("sessions with pins", () => {
  it("round-trips pins and offsets, and stays compatible with files without them", () => {
    const g = graph(C, [N], [[C, N]]);
    const p = new Map<string, Pin>([[P, { node: node(P), offset: { x: 10, y: -20 } }], [Q, { node: node(Q) }]]);
    const s = captureSession("s", "/a.bim", g, { ...DEFAULT_OPTIONS, depth: 1 }, "radial", p)!;
    expect(s.pinned).toEqual([{ key: P, offset: { x: 10, y: -20 } }, { key: Q }]);
    expect(parseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const { pinned: _p, ...old } = s;
    expect(parseSession(JSON.parse(JSON.stringify(old))).pinned).toBeUndefined();
    const bad = parseSession({ ...s, pinned: [{ key: "nope" }, { key: P, offset: { x: Infinity, y: 1 } }, null] });
    expect(bad.pinned).toEqual([{ key: P }]);
  });
});

describe("pins in the store", () => {
  let store: typeof import("../src/frontend/state/graphStore");
  const key = (cls: string, id: string) => nodeKeyString({ classId: fx.classIds[cls], id });
  const nk = (cls: string, id: string) => ({ classId: fx.classIds[cls], id });
  const state = () => store.useGraphStore.getState();
  const pinKeys = () => [...state().pins.keys()].sort();

  beforeAll(async () => {
    const mem = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    store = await import("../src/frontend/state/graphStore");
    await store.graphActions.attach(fx.db as never, "fixture.bim", "fallback");
  });

  it("keeps pins through graph navigation while they stay chained to the centre, and drops them otherwise", async () => {
    const { graphActions } = store;
    const pump1 = key("TestIG:Pump", fx.ids.pump1), pipeA = key("TestIG:Pipe", fx.ids.pipeA);
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    graphActions.togglePin(pump1);
    graphActions.togglePin(pipeA);
    expect(pinKeys()).toEqual([pump1, pipeA].sort());

    // Pump2's neighbourhood holds PipeA but not Pump1; Pump1 stays through its link to pinned PipeA.
    await graphActions.centreOn(nk("TestIG:Pump", fx.ids.pump2));
    expect(state().baseGraph.nodes.has(pump1)).toBe(false);
    expect(pinKeys()).toEqual([pump1, pipeA].sort());
    expect(state().graph.nodes.has(pump1)).toBe(true);
    expect([...state().graph.edges.values()].some((e) => (e.source === pump1 && e.target === pipeA) || (e.source === pipeA && e.target === pump1))).toBe(true);

    // Expanding the pin that is outside the traversal brings it and its neighbours in.
    await graphActions.expand(pump1);
    expect(state().baseGraph.nodes.has(pump1)).toBe(true);
    expect(state().graph.nodes.has(key("TestIG:Pipe", fx.ids.pipeB))).toBe(true);
    expect(pinKeys()).toEqual([pump1, pipeA].sort());

    // A hub pipe is related to neither pin: both drop, and Back restores them.
    await graphActions.centreOn(nk("TestIG:Pipe", fx.ids.hubPipes[0]));
    expect(state().pins.size).toBe(0);
    expect(state().graph.nodes.has(pipeA)).toBe(false);
    graphActions.back();
    expect(pinKeys()).toEqual([pump1, pipeA].sort());
    expect(state().graph.nodes.has(pump1)).toBe(true);
  });

  it("clears pins when the centre comes from outside the graph", async () => {
    const { graphActions } = store;
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    graphActions.togglePin(key("TestIG:Pipe", fx.ids.pipeA));
    expect(state().pins.size).toBe(1);
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    expect(state().pins.size).toBe(0);
  });

  it("restores saved pins, skipping instances that no longer exist", async () => {
    const { graphActions } = store;
    const pipeA = key("TestIG:Pipe", fx.ids.pipeA);
    await graphActions.seedExternal(nk("TestIG:Pump", fx.ids.pump1));
    graphActions.togglePin(pipeA);
    graphActions.setPinOffset(pipeA, { x: 40, y: 50 });
    const s = captureSession("s", "fixture.bim", state().graph, state().options, "radial", state().pins)!;
    const withGhost = { ...s, pinned: [...s.pinned!, { key: `${fx.classIds["TestIG:Pipe"]}:0xfffffff` }] };
    await graphActions.seedExternal(nk("TestIG:Pipe", fx.ids.hubPipes[1]));
    expect(state().pins.size).toBe(0);
    await graphActions.restoreSession(withGhost);
    expect(pinKeys()).toEqual([pipeA]);
    expect(state().pins.get(pipeA)!.offset).toEqual({ x: 40, y: 50 });
  });
});

describe("connecting pins in the engine", () => {
  const engines: Record<string, GraphEngine> = {};
  const key = (cls: string, id: string) => nodeKeyString({ classId: fx.classIds[cls], id });
  const nk = (cls: string, id: string) => ({ classId: fx.classIds[cls], id });
  beforeAll(async () => {
    const port = createQueryPort(fx.db as unknown as QuerySource);
    engines.relations = await GraphEngine.create(port, "relations");
    engines.fallback = await GraphEngine.create(port, "fallback");
  });

  it.each(["relations", "fallback"])("finds edges from pins to the graph without adding nodes (%s)", async (name) => {
    const engine = engines[name];
    const opts = { ...DEFAULT_OPTIONS, depth: 1 };
    const base = await engine.buildNeighbourhood(nk("TestIG:Pump", fx.ids.pump1), opts);
    const pump2 = key("TestIG:Pump", fx.ids.pump2);
    expect(base.nodes.has(pump2)).toBe(false);
    const resolved = await engine.resolver.resolve([nk("TestIG:Pump", fx.ids.pump2)]);
    const p = new Map<string, Pin>([[pump2, { node: { ...resolved.get(pump2)!, depth: 2, expanded: false } }]]);
    const edges = await engine.connectPinned(base, p, opts);
    const ends = new Set([...edges.values()].map((e) => (e.source === pump2 ? e.target : e.source)));
    expect(ends.has(key("TestIG:Pipe", fx.ids.pipeA))).toBe(true);
    expect(ends.has(key("TestIG:Pipe", fx.ids.pipeB))).toBe(true);
    for (const e of edges.values()) expect(e.source === pump2 || e.target === pump2).toBe(true);
    for (const e of edges.values()) expect(base.edges.has(e.key)).toBe(false);
  });

  it.each(["relations", "fallback"])("links a pinned hub to a pipe beyond the group cap (%s)", async (name) => {
    const engine = engines[name];
    const opts = { ...DEFAULT_OPTIONS, depth: 1, groupCap: 5 };
    const last = fx.ids.hubPipes[fx.ids.hubPipes.length - 1];
    const base = await engine.buildNeighbourhood(nk("TestIG:Pipe", last), opts);
    const hub = key("TestIG:Pump", fx.ids.hub);
    const p = new Map<string, Pin>([[hub, { node: base.nodes.get(hub) ?? { ...(await engine.resolver.resolve([nk("TestIG:Pump", fx.ids.hub)])).get(hub)!, depth: 2, expanded: false } }]]);
    const edges = await engine.connectPinned(base, p, opts);
    const all = [...base.edges.values(), ...edges.values()];
    expect(all.some((e) => (e.source === hub && e.target === key("TestIG:Pipe", last)) || (e.target === hub && e.source === key("TestIG:Pipe", last)))).toBe(true);
  });

  it("tells which instances still exist", async () => {
    const got = await engines.fallback.existingKeys([nk("TestIG:Pump", fx.ids.pump1), nk("TestIG:Pump", "0xfffffff"), { classId: fx.classIds["TestIG:Pipe"], id: fx.ids.pump1 }]);
    expect([...got]).toEqual([key("TestIG:Pump", fx.ids.pump1)]);
  });
});
