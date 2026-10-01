import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRelationsQuery, buildTraversalRecipe, EXPERIMENTAL_OPTION } from "../src/frontend/engine/ecsql";
import { DEFAULT_OPTIONS, GraphEngine, TraversalCancelled, type TraversalOptions } from "../src/frontend/engine/GraphEngine";
import { aggregateKey, type GraphData, nodeKeyString } from "../src/frontend/engine/GraphModel";
import { RelationsTraversal } from "../src/frontend/engine/TraversalStrategy";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { loadInstanceProperties } from "../src/frontend/engine/instanceProperties";
import { EMPTY_FILTERS } from "../src/frontend/engine/filters";
import { runSeedQuery } from "../src/frontend/engine/seedQuery";
import { createFixture, type Fixture, HUB_FANOUT } from "./fixture";

let fx: Fixture;
let relations: GraphEngine;
let fallback: GraphEngine;

const key = (cls: string, id: string) => nodeKeyString({ classId: fx.classIds[cls], id });
const opts = (o: Partial<TraversalOptions> = {}): TraversalOptions => ({ ...DEFAULT_OPTIONS, ...o });
const centre = (cls: string, id: string) => ({ classId: fx.classIds[cls], id });
const edgesBetween = (g: GraphData, a: string, b: string) =>
  [...g.edges.values()].filter((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

beforeAll(async () => {
  fx = await createFixture();
  const port = createQueryPort(fx.db as unknown as QuerySource);
  relations = await GraphEngine.create(port, "relations");
  fallback = await GraphEngine.create(port, "fallback");
});

afterAll(async () => fx?.close());

describe("ecsql builders", () => {
  it("always carry the experimental option on Relations() statements", () => {
    const q = buildRelationsQuery([{ id: "0x1", classId: "0x2" }], "both");
    expect(q).toContain("ECVLib.Relations");
    expect(q.trim().endsWith(EXPERIMENTAL_OPTION)).toBe(true);
    expect(buildTraversalRecipe({ id: "0x1", classId: "0x2" }, 2, "forward")).toContain(EXPERIMENTAL_OPTION);
  });

  it("rejects non-id input", () => {
    expect(() => buildRelationsQuery([{ id: "1; DROP", classId: "0x2" }], "both")).toThrow();
  });
});

describe("strategy selection", () => {
  it("uses Relations() when available", () => {
    expect(relations.strategy.name).toBe("relations");
    expect(fallback.strategy.name).toBe("fallback");
  });
});

describe.each([["relations"], ["fallback"]] as const)("GraphEngine (%s)", (name) => {
  const engine = () => (name === "relations" ? relations : fallback);

  it("returns nav and link-table edges between the same pair as distinct edges", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts());
    const pump1 = key("TestIG:Pump", fx.ids.pump1);
    const pipeA = key("TestIG:Pipe", fx.ids.pipeA);
    expect(g.centreKey).toBe(pump1);
    const between = edgesBetween(g, pump1, pipeA);
    expect(between.map((e) => e.kind).sort()).toEqual(["linkTable", "navigation"]);
    const link = between.find((e) => e.kind === "linkTable")!;
    expect(link.relClassName).toBe("TestIG:PumpFeedsPipe");
    expect(link.source).toBe(pump1);
    expect(link.cardinality).toBeDefined();
    const nav = between.find((e) => e.kind === "navigation")!;
    expect(nav.relClassName).toBe("TestIG:PumpOwnsPipes");
    expect(nav.source).toBe(pump1);
    expect(nav.target).toBe(pipeA);
  });

  it("includes the containing model, and keeps partition and model distinct though they share an id", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts({ depth: 2 }));
    const model = key("BisCore:PhysicalModel", fx.ids.plantA);
    const partition = key("BisCore:PhysicalPartition", fx.ids.plantA);
    expect(g.nodes.get(model)?.category).toBe("model");
    expect(g.nodes.has(partition)).toBe(true);
    expect(model).not.toBe(partition);
  });

  it("excludes one instance and paths through it while preserving alternate paths", async () => {
    const pipeA = key("TestIG:Pipe", fx.ids.pipeA);
    const pump2 = key("TestIG:Pump", fx.ids.pump2);
    const filters = { ...EMPTY_FILTERS, schemas: { TestIG: "include" as const } };
    const options = opts({ depth: 2, filters, excludedInstances: [pipeA] });
    const progress: GraphData[] = [];
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), options, (partial) => progress.push(partial));
    expect(g.nodes.has(pipeA)).toBe(false);
    expect(g.nodes.has(pump2)).toBe(true); // Still reachable through PipeB.
    for (const partial of [...progress, g]) {
      expect(partial.nodes.has(pipeA)).toBe(false);
      expect([...partial.edges.values()].some((e) => e.source === pipeA || e.target === pipeA)).toBe(false);
    }
    const blocked = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      { ...options, excludedInstances: [pipeA, key("TestIG:Pipe", fx.ids.pipeB)] });
    expect(blocked.nodes.has(pump2)).toBe(false);
    await expect(engine().buildNeighbourhood(centre("TestIG:Pipe", fx.ids.pipeA), options)).rejects.toThrow("excluded");
  });

  it("uses full class/id identity when excluding a partition or model", async () => {
    const model = key("BisCore:PhysicalModel", fx.ids.plantA);
    const partition = key("BisCore:PhysicalPartition", fx.ids.plantA);
    const g = await engine().buildNeighbourhood(centre("BisCore:PhysicalModel", fx.ids.plantA),
      opts({ excludedInstances: [partition] }));
    expect(g.nodes.has(partition)).toBe(false);
    expect(g.nodes.has(model)).toBe(true);
    expect(g.nodes.has(key("TestIG:Pump", fx.ids.pump1))).toBe(true);
  });

  it("assigns BFS depth and closes the cycle without duplicates", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts({ depth: 2 }));
    expect(g.nodes.get(key("TestIG:Pipe", fx.ids.pipeB))?.depth).toBe(1);
    expect(g.nodes.get(key("TestIG:Pump", fx.ids.pump2))?.depth).toBe(2);
    // Pump2 feeds both pipes: both edges present once.
    const pump2 = key("TestIG:Pump", fx.ids.pump2);
    expect(edgesBetween(g, pump2, key("TestIG:Pipe", fx.ids.pipeA))).toHaveLength(1);
    expect(edgesBetween(g, pump2, key("TestIG:Pipe", fx.ids.pipeB))).toHaveLength(1);
    expect(new Set(g.edges.keys()).size).toBe(g.edges.size);
  });

  it("summarises large fans into an aggregate node, and opens it on request", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), opts({ groupCap: 10 }));
    const aggs = [...g.nodes.values()].filter((n) => n.aggregate);
    expect(aggs).toHaveLength(1);
    expect(aggs[0].aggregate!.hiddenCount).toBe(HUB_FANOUT - 10);
    expect([...g.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(10);

    const { graph, expandedGroups } = await engine().openAggregate(g, aggs[0].key, opts({ groupCap: 10 }));
    expect(expandedGroups.has(aggs[0].key)).toBe(true);
    expect([...graph.nodes.values()].filter((n) => n.aggregate)).toHaveLength(0);
    expect([...graph.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(HUB_FANOUT);
  });

  describe("server-side capping of large fans", () => {
    const saved = RelationsTraversal.probeRows;
    beforeAll(() => { RelationsTraversal.probeRows = 8; });
    afterAll(() => { RelationsTraversal.probeRows = saved; });
    const hubAgg = () => aggregateKey(key("TestIG:Pump", fx.ids.hub), fx.classIds["TestIG:PumpFeedsPipe"], "forward");

    it("counts hidden instances from the server-side total", async () => {
      const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), opts({ groupCap: 3 }));
      expect(g.nodes.get(hubAgg())?.aggregate?.hiddenCount).toBe(HUB_FANOUT - 3);
      expect([...g.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(3);
    });

    it("excludes hub targets before caps and totals, including aggregate opening", async () => {
      const excludedInstances = fx.ids.hubPipes.slice(0, 6).map((id) => key("TestIG:Pipe", id));
      const options = opts({ groupCap: 3, excludedInstances });
      const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), options);
      expect(g.nodes.get(hubAgg())?.aggregate?.hiddenCount).toBe(HUB_FANOUT - 6 - 3);
      expect([...g.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(3);
      const { graph } = await engine().openAggregate(g, hubAgg(), options);
      expect([...graph.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(HUB_FANOUT - 6);
      for (const key of excludedInstances) expect(graph.nodes.has(key)).toBe(false);
    });

    it("applies exclusions before the windowed Relations() count without a fallback", async () => {
      if (name !== "relations") return;
      const strategy = new RelationsTraversal(createQueryPort(fx.db as unknown as QuerySource));
      const excludedInstances = fx.ids.hubPipes.slice(0, 6).map((id) => key("TestIG:Pipe", id));
      const result = await strategy.neighbours([centre("TestIG:Pump", fx.ids.hub)], "both",
        { fetchLimit: 3, maxRows: 100, unlimited: new Set(), knownIds: [], excludedInstances });
      expect(result.totals.get(hubAgg())).toBe(HUB_FANOUT - 6);
      expect(result.relations.filter((r) => r.relClassId === fx.classIds["TestIG:PumpFeedsPipe"])).toHaveLength(3);
      for (const r of result.relations) expect(excludedInstances).not.toContain(nodeKeyString(r.related));
    });

    it("keeps links to instances already on the graph and excludes them from the hidden count", async () => {
      const last = fx.ids.hubPipes[HUB_FANOUT - 1];
      const g = await engine().buildNeighbourhood(centre("TestIG:Pipe", last), opts({ depth: 2, groupCap: 3 }));
      expect(edgesBetween(g, key("TestIG:Pump", fx.ids.hub), key("TestIG:Pipe", last)).map((e) => e.kind)).toEqual(["linkTable"]);
      expect(g.nodes.get(hubAgg())?.aggregate?.hiddenCount).toBe(HUB_FANOUT - 3 - 1);
    });

    it("caps a hub with one windowed Relations() scan when no fallback is available", async () => {
      if (name !== "relations") return;
      const strategy = new RelationsTraversal(createQueryPort(fx.db as unknown as QuerySource));
      const hubKey = centre("TestIG:Pump", fx.ids.hub);
      const known = fx.ids.hubPipes[HUB_FANOUT - 1];
      const r = await strategy.neighbours([centre("TestIG:Pipe", fx.ids.pipeA), hubKey], "both", { fetchLimit: 5, maxRows: 100, unlimited: new Set(), knownIds: [known] });
      const feeds = r.relations.filter((x) => x.seed.id === fx.ids.hub && x.relClassId === fx.classIds["TestIG:PumpFeedsPipe"]);
      expect(r.totals.get(hubAgg())).toBe(HUB_FANOUT);
      expect(feeds.length).toBe(6); // 5 + the known one
      expect(feeds.some((x) => x.related.id === known)).toBe(true);
      expect(r.relations.some((x) => x.seed.id === fx.ids.pipeA)).toBe(true);
    });

    it("routes hub seeds to the metadata fallback", async () => {
      if (name !== "relations") return;
      const before = (relations.strategy as RelationsTraversal).hubSeeds;
      await relations.buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), opts({ groupCap: 3 }));
      expect((relations.strategy as RelationsTraversal).hubSeeds).toBeGreaterThan(before);
    });

    it("loads the whole group when the aggregate is opened", async () => {
      const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), opts({ groupCap: 3 }));
      const { graph } = await engine().openAggregate(g, hubAgg(), opts({ groupCap: 3 }));
      expect(graph.nodes.has(hubAgg())).toBe(false);
      expect([...graph.nodes.values()].filter((n) => n.className === "TestIG:Pipe")).toHaveLength(HUB_FANOUT);
    });
  });

  it("stops at the node budget and marks the graph truncated", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.hub), opts({ nodeBudget: 5 }));
    expect(g.truncated).toBe(true);
    // Aggregate markers are not instances and don't count towards the budget.
    expect([...g.nodes.values()].filter((n) => !n.aggregate).length).toBe(5);
  });

  it("applies class, relationship and model filters but never removes the centre", async () => {
    const pump1 = key("TestIG:Pump", fx.ids.pump1);
    let g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, classes: { "TestIG:Pipe": { state: "include", polymorphic: true }, "TestIG:Pump": { state: "include", polymorphic: true } } } }));
    expect(g.nodes.has(pump1)).toBe(true);
    expect([...g.nodes.values()].every((n) => n.className.startsWith("TestIG:"))).toBe(true);

    g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, relationships: { "BisCore:ElementRefersToElements": { state: "exclude", polymorphic: true } } } }));
    expect([...g.edges.values()].some((e) => e.kind === "linkTable")).toBe(false);

    g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, models: { [fx.ids.plantB]: "exclude" } } }));
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeB))).toBe(false);
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeA))).toBe(true);

    // PlantA and PlantB are sub-models of the RepositoryModel, so excluding it hides both.
    g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, models: { "0x1": "exclude" } } }));
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeA))).toBe(false);
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeB))).toBe(false);

    // ...and a sub-model's own state overrides the inherited one.
    g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, models: { "0x1": "exclude", [fx.ids.plantB]: "include" } } }));
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeA))).toBe(false);
    expect(g.nodes.has(key("TestIG:Pipe", fx.ids.pipeB))).toBe(true);

    g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ filters: { ...EMPTY_FILTERS, schemas: { BisCore: "exclude" } } }));
    expect([...g.nodes.values()].filter((n) => n.key !== pump1).every((n) => n.schemaName === "TestIG")).toBe(true);
  });

  it("loads each model's parent model", () => {
    const models = new Map(engine().models.map((m) => [m.id, m]));
    expect(models.get(fx.ids.plantA)?.parentId).toBe("0x1");
    expect(models.get(fx.ids.plantB)?.parentId).toBe("0x1");
    expect(models.get("0x1")?.parentId).toBeUndefined();
  });

  it("respects the direction filter", async () => {
    const g = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts({ direction: "forward" }));
    const pump1 = key("TestIG:Pump", fx.ids.pump1);
    for (const e of g.edges.values()) expect(e.source).toBe(pump1);
  });

  it("expands and collapses a node", async () => {
    const g1 = await engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts());
    const pipeA = key("TestIG:Pipe", fx.ids.pipeA);
    const pump2 = key("TestIG:Pump", fx.ids.pump2);
    expect(g1.nodes.has(pump2)).toBe(false);
    const g2 = await engine().expand(g1, pipeA, opts());
    expect(g2.nodes.has(pump2)).toBe(true);
    expect(g2.nodes.get(pipeA)!.expanded).toBe(true);
    const g3 = engine().collapse(g2, pipeA);
    // Pump2 is still reachable via PipeB? Only if PipeB was expanded - it was not, so it goes.
    expect(g3.nodes.has(pump2)).toBe(false);
    expect(g3.nodes.has(pipeA)).toBe(true);
    for (const k of g1.nodes.keys()) expect(g3.nodes.has(k)).toBe(true);
  });

  it("honours cancellation", async () => {
    await expect(engine().buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts(), undefined, { cancelled: true }))
      .rejects.toBeInstanceOf(TraversalCancelled);
  });
});

describe("strategy parity", () => {
  it("Relations() and fallback produce the same graph", async () => {
    for (const id of [fx.ids.pump1, fx.ids.pipeB]) {
      const cls = id === fx.ids.pump1 ? "TestIG:Pump" : "TestIG:Pipe";
      const a = await relations.buildNeighbourhood(centre(cls, id), opts({ depth: 2 }));
      const b = await fallback.buildNeighbourhood(centre(cls, id), opts({ depth: 2 }));
      expect([...b.nodes.keys()].sort()).toEqual([...a.nodes.keys()].sort());
      expect([...b.edges.keys()].sort()).toEqual([...a.edges.keys()].sort());
    }
  });
});

describe("Relations() degradation", () => {
  it("reports failed exclusion queries rather than silently omitting relationships", async () => {
    const base = createQueryPort(fx.db as unknown as QuerySource);
    const failing = { ...base, query: async (sql: string, binder?: Parameters<typeof base.query>[1]) => {
      if (sql.includes("NOT (")) throw new Error("Exclusion query failed");
      return base.query(sql, binder);
    } };
    const engine = await GraphEngine.create(failing, "fallback");
    await expect(engine.buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1),
      opts({ excludedInstances: [key("TestIG:Pipe", fx.ids.pipeA)] }))).rejects.toThrow("Exclusion query failed");
  });

  it("answers a batch with the metadata fallback when its Relations() statement fails", async () => {
    const base = createQueryPort(fx.db as unknown as QuerySource);
    const flaky = { ...base, query: async (sql: string, b?: any) => {
      if (sql.includes("ECVLib.Relations(s.id"))
        throw new Error("query too long to execute or server is too busy");
      return base.query(sql, b);
    } };
    const engine = await GraphEngine.create(flaky, "relations");
    expect(engine.strategy.name).toBe("relations");
    const g = await engine.buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts({ depth: 2 }));
    const expected = await fallback.buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts({ depth: 2 }));
    expect([...g.edges.keys()].sort()).toEqual([...expected.edges.keys()].sort());
    expect((engine.strategy as RelationsTraversal).degradedBatches).toBeGreaterThan(0);
  });
});

describe("relationship info", () => {
  it("reports cardinality and strength", () => {
    const info = relations.relationships.get(fx.classIds["TestIG:PumpOwnsPipes"])!;
    expect(info.strength).toBe("referencing");
    expect(info.source.multiplicity).toBe("0..1");
    expect(info.target.multiplicity).toBe("0..*");
  });
});

describe("properties", () => {
  it("flattens instance properties including navigation targets", async () => {
    const props = await loadInstanceProperties(relations.port, relations.registry, "TestIG:Pipe", fx.ids.pipeA);
    const byName = new Map(props.map((p) => [p.name, p]));
    expect(byName.get("UserLabel")?.value).toBe("Pipe-A");
    const owner = byName.get("OwnerPump");
    expect(owner?.kind).toBe("navigation");
    expect(owner?.navTarget?.id).toBe(fx.ids.pump1);
    expect(byName.get("Model")?.navTarget?.id).toBe(fx.ids.plantA);
  });
});

describe("seed query", () => {
  it("uses ECInstanceId/ECClassId columns and resolves labels", async () => {
    const r = await runSeedQuery(relations, "SELECT ECInstanceId, ECClassId FROM TestIG.Pump ORDER BY UserLabel");
    expect(r.candidates.map((c) => c.label)).toEqual(["Header", "Pump-1", "Pump-2"]);
    expect(r.candidates[0].key.classId).toBe(fx.classIds["TestIG:Pump"]);
    expect(r.candidates[0].className).toBe("TestIG:Pump");
    expect(r.skipped).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("looks up the class when only an id is selected, and dedupes", async () => {
    const r = await runSeedQuery(fallback, `SELECT p.ECInstanceId FROM TestIG.Pipe p WHERE p.OwnerPump.Id = ${fx.ids.pump1} UNION ALL SELECT ECInstanceId FROM TestIG.Pipe WHERE ECInstanceId = ${fx.ids.pipeA}`);
    expect(r.candidates.map((c) => c.key.id).sort()).toEqual([fx.ids.pipeA, fx.ids.pipeB].sort());
    expect(r.candidates.every((c) => c.key.classId === fx.classIds["TestIG:Pipe"])).toBe(true);
  });

  it("accepts aliased id columns and class names", async () => {
    const r = await runSeedQuery(relations, `SELECT ECInstanceId Id, ec_classname(ECClassId) ClassName FROM TestIG.Pump WHERE ECInstanceId = ${fx.ids.pump2}`);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].key).toEqual({ id: fx.ids.pump2, classId: fx.classIds["TestIG:Pump"] });
  });

  it("skips rows without ids", async () => {
    const r = await runSeedQuery(relations, "SELECT UserLabel FROM TestIG.Pump");
    expect(r.candidates).toHaveLength(0);
    expect(r.skipped).toBe(3);
  });
});

describe("aspects", () => {
  it.each(["relations", "fallback"] as const)("resolves element aspects as aspect nodes owned by their element (%s)", async (which) => {
    const engine = which === "relations" ? relations : fallback;
    const g = await engine.buildNeighbourhood(centre("TestIG:Pump", fx.ids.pump1), opts());
    const aspect = [...g.nodes.values()].find((n) => n.className === "TestIG:PumpSpec");
    expect(aspect, "aspect node").toBeDefined();
    expect(aspect!.category).toBe("aspect");
    expect(edgesBetween(g, key("TestIG:Pump", fx.ids.pump1), aspect!.key).length).toBeGreaterThan(0);
  });
});
