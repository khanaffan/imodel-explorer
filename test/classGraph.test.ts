import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCensus } from "../src/frontend/engine/census";
import { buildClassGraph, collapseToClasses, loadRelationshipCensus, mergeRelationshipCounts, relationshipRoots } from "../src/frontend/engine/classGraph";
import { GraphEngine, TraversalCancelled } from "../src/frontend/engine/GraphEngine";
import type { GraphData, GraphEdge, GraphNode } from "../src/frontend/engine/GraphModel";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { rankSeedCandidates } from "../src/frontend/engine/seedQuery";
import { createFixture, type Fixture, HUB_FANOUT } from "./fixture";

let fx: Fixture;
let engine: GraphEngine;

beforeAll(async () => {
  fx = await createFixture();
  engine = await GraphEngine.create(createQueryPort(fx.db as unknown as QuerySource));
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

function syntheticGraph(): GraphData {
  const node = (key: string, classId: string, className: string, aggregate = false): GraphNode => ({
    key, id: key.split(":")[1], classId, className, schemaName: className.split(":")[0], label: key,
    category: "geometric3d", classHierarchy: [className], depth: 1, expanded: false,
    ...(aggregate ? { aggregate: { ownerKey: "x", relClassId: "0x9", relClassName: "T:R", direction: "forward" as const, hiddenCount: 5 } } : {}),
  });
  const edge = (key: string, source: string, target: string, kind: GraphEdge["kind"]): GraphEdge => ({
    key, source, target, relClassId: "0x9", relClassName: "TestIG:Feeds", relInstanceId: key, kind,
  });
  const nodes = new Map([
    ["0x1:0x10", node("0x1:0x10", "0x1", "TestIG:Pump")],
    ["0x1:0x11", node("0x1:0x11", "0x1", "TestIG:Pump")],
    ["0x2:0x12", node("0x2:0x12", "0x2", "TestIG:Pipe")],
    ["agg:1", node("agg:1", "0x2", "TestIG:Pipe", true)],
  ]);
  const edges = new Map([
    ["e1", edge("e1", "0x1:0x10", "0x2:0x12", "linkTable")],
    ["e2", edge("e2", "0x1:0x11", "0x2:0x12", "linkTable")],
    ["e3", edge("e3", "0x1:0x10", "0x1:0x11", "navigation")], // becomes a class self-loop
    ["e4", edge("e4", "0x1:0x10", "agg:1", "aggregate")], // skipped
  ]);
  return { centreKey: "0x1:0x10", nodes, edges, truncated: false };
}

describe("collapseToClasses", () => {
  it("groups instances and edges by class, skipping aggregates", () => {
    const cg = collapseToClasses(syntheticGraph(), engine.registry);
    expect(cg.nodes.size).toBe(2);
    expect(cg.nodes.get("0x1")?.instanceCount).toBe(2);
    expect(cg.nodes.get("0x2")?.instanceCount).toBe(1);

    expect(cg.edges.size).toBe(2);
    const feed = [...cg.edges.values()].find((e) => e.kind === "linkTable")!;
    expect(feed).toMatchObject({ source: "0x1", target: "0x2", count: 2 });
    const loop = [...cg.edges.values()].find((e) => e.kind === "navigation")!;
    expect(loop).toMatchObject({ source: "0x1", target: "0x1", count: 1 });
  });
});

describe("buildClassGraph", () => {
  it("finds the observed class pairs with exact counts and kinds", async () => {
    const census = await loadCensus(engine.port, engine.registry);
    const cg = await buildClassGraph(engine.port, engine.registry, { census });
    const byRel = (rel: string, src: string, tgt: string) =>
      [...cg.edges.values()].find((e) => e.relClassName === rel
        && cg.nodes.get(e.source)?.className === src && cg.nodes.get(e.target)?.className === tgt);

    const feeds = byRel("TestIG:PumpFeedsPipe", "TestIG:Pump", "TestIG:Pipe")!;
    expect(feeds).toMatchObject({ kind: "linkTable", count: 3 + HUB_FANOUT });
    expect(feeds.cardinality).toBeDefined();

    const owns = byRel("TestIG:PumpOwnsPipes", "TestIG:Pump", "TestIG:Pipe")!;
    expect(owns).toMatchObject({ kind: "navigation", count: 2 });

    expect(byRel("BisCore:ElementOwnsUniqueAspect", "TestIG:Pump", "TestIG:PumpSpec")).toMatchObject({ kind: "navigation", count: 1 });
    expect(byRel("BisCore:ModelContainsElements", "BisCore:PhysicalModel", "TestIG:Pipe")).toMatchObject({ kind: "navigation", count: 2 + HUB_FANOUT });

    // Node counts come from the census.
    const pump = [...cg.nodes.values()].find((n) => n.className === "TestIG:Pump")!;
    expect(pump.instanceCount).toBe(3);
    expect(pump.category).toBe("geometric3d");

    // No system-schema relationships or endpoints.
    for (const n of cg.nodes.values()) expect(n.schemaName.startsWith("ECDb")).toBe(false);
    for (const e of cg.edges.values()) expect(e.relClassName.startsWith("ECDb")).toBe(false);
  });

  it("streams progress and honours cancellation", async () => {
    const total = relationshipRoots(engine.registry).length;
    expect(total).toBeGreaterThan(5);

    let calls = 0;
    await buildClassGraph(engine.port, engine.registry, {
      onProgress: (partial, p) => {
        calls++;
        expect(p.total).toBe(total);
        expect(p.done).toBeGreaterThan(0);
        expect(partial.nodes).toBeDefined();
      },
    });
    expect(calls).toBe(total);

    const cancel = { cancelled: true };
    await expect(buildClassGraph(engine.port, engine.registry, { cancel })).rejects.toThrow(TraversalCancelled);
  });

  it("excludes system schemas from the roots", () => {
    const roots = relationshipRoots(engine.registry);
    expect(roots.some((r) => r.startsWith("ECDb"))).toBe(false);
    expect(roots).toContain("TestIG:PumpOwnsPipes");
    // Derives from bis:ElementRefersToElements, so its root's polymorphic query covers it.
    expect(roots).not.toContain("TestIG:PumpFeedsPipe");
  });
});

describe("loadRelationshipCensus", () => {
  it("counts link-table relationships and lists navigation ones without counts", async () => {
    const entries = await loadRelationshipCensus(engine.port, engine.registry);

    const feeds = entries.find((e) => e.className === "TestIG:PumpFeedsPipe")!;
    expect(feeds).toMatchObject({ kind: "linkTable", count: 3 + HUB_FANOUT, schemaName: "TestIG" });

    const owns = entries.find((e) => e.className === "TestIG:PumpOwnsPipes")!;
    expect(owns.kind).toBe("navigation");
    expect(owns.count).toBeUndefined();

    // Counted entries sort before uncounted ones.
    const firstUncounted = entries.findIndex((e) => e.count === undefined);
    expect(entries.slice(firstUncounted).every((e) => e.count === undefined)).toBe(true);
    expect(entries.some((e) => e.className.startsWith("ECDb"))).toBe(false);
  });

  it("merges navigation counts from the class graph", async () => {
    const entries = await loadRelationshipCensus(engine.port, engine.registry);
    const cg = await buildClassGraph(engine.port, engine.registry, {});
    const merged = mergeRelationshipCounts(entries, cg, engine.registry);

    expect(merged.find((e) => e.className === "TestIG:PumpOwnsPipes")?.count).toBe(2);
    // Unchanged link-table count survives the merge.
    expect(merged.find((e) => e.className === "TestIG:PumpFeedsPipe")?.count).toBe(3 + HUB_FANOUT);
    // ModelContainsElements covers every model in the iModel.
    expect(merged.find((e) => e.className === "BisCore:ModelContainsElements")!.count).toBeGreaterThanOrEqual(2 + HUB_FANOUT + 3);
  });
});

describe("rankSeedCandidates", () => {
  it("ranks the hub above less connected instances, using capped-group totals", async () => {
    const pump = engine.registry.idOf("TestIG:Pump")!;
    const keys = [
      { classId: pump, id: fx.ids.pump2 },
      { classId: pump, id: fx.ids.hub },
      { classId: pump, id: fx.ids.pump1 },
    ];
    const ranks = await rankSeedCandidates(engine, keys);
    const of = (id: string) => ranks.get(`${pump}:${id}`)!;
    // The hub feeds HUB_FANOUT pipes; the fetch cap is far smaller, so this exercises totals.
    expect(of(fx.ids.hub)).toBeGreaterThanOrEqual(HUB_FANOUT);
    expect(of(fx.ids.hub)).toBeGreaterThan(of(fx.ids.pump2));
    expect(of(fx.ids.pump1)).toBeGreaterThan(0);
  });
});
