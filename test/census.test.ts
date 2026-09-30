import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCensus, loadModelCensus, loadModelTotals, schemaUsage } from "../src/frontend/engine/census";
import { GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
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

describe("census", () => {
  it("counts elements, aspects and models per class, sorted by count", async () => {
    const census = await loadCensus(engine.port, engine.registry);
    const by = (cls: string, kind = "element") => census.entries.find((e) => e.className === cls && e.kind === kind);

    expect(by("TestIG:Pump")?.count).toBe(3); // Pump-1, Pump-2, Header
    expect(by("TestIG:Pipe")?.count).toBe(2 + HUB_FANOUT);
    expect(by("TestIG:PumpSpec", "aspect")?.count).toBe(1);
    expect(by("BisCore:PhysicalModel", "model")?.count).toBe(2); // PlantA, PlantB
    expect(by("TestIG:Pump")?.category).toBe("geometric3d");

    // Sorted by count descending.
    const counts = census.entries.map((e) => e.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(census.totalInstances).toBe(counts.reduce((s, n) => s + n, 0));

    // System schemas never show up.
    expect(census.entries.some((e) => e.schemaName.startsWith("ECDb"))).toBe(false);
  });

  it("rolls usage up per schema", async () => {
    const census = await loadCensus(engine.port, engine.registry);
    const testIg = census.schemas.find((s) => s.schemaName === "TestIG")!;
    expect(testIg.classesUsed).toBe(3); // Pump, Pipe, PumpSpec (SmartPump/Mk2 are defined but unused)
    expect(testIg.classesDefined).toBeGreaterThan(testIg.classesUsed);
    expect(testIg.instances).toBe(3 + 2 + HUB_FANOUT + 1);
    // Ordered by instance count.
    const inst = census.schemas.map((s) => s.instances);
    expect([...inst].sort((a, b) => b - a)).toEqual(inst);
  });

  it("counts per class inside one model, lazily", async () => {
    const rows = await loadModelCensus(engine.port, engine.registry, fx.ids.plantA);
    const pipe = rows.find((r) => r.className === "TestIG:Pipe");
    expect(pipe?.count).toBe(1 + HUB_FANOUT); // Pipe-B lives in PlantB
    expect(rows.find((r) => r.className === "TestIG:Pump")?.count).toBe(3);
    expect(await loadModelCensus(engine.port, engine.registry, "junk; DROP")).toEqual([]);
  });

  it("totals elements per model", async () => {
    const totals = await loadModelTotals(engine.port);
    expect(totals.get(fx.ids.plantB)).toBe(1);
    expect(totals.get(fx.ids.plantA)).toBe(3 + 1 + HUB_FANOUT);
  });

  it("schemaUsage never reports more defined than used", async () => {
    const census = await loadCensus(engine.port, engine.registry);
    const usage = schemaUsage(census.entries, engine.registry);
    for (const s of usage)
      expect(s.classesDefined).toBeGreaterThanOrEqual(s.classesUsed);
  });
});
