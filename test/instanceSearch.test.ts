import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { buildInstanceSearchQuery, searchInstances } from "../src/frontend/engine/instanceSearch";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let engine: GraphEngine;

beforeAll(async () => {
  fx = await createFixture();
  engine = await GraphEngine.create(createQueryPort(fx.db as unknown as QuerySource));
});
afterAll(async () => fx?.close());

describe("instance search", () => {
  it("needs two characters unless the text is an id", () => {
    expect(buildInstanceSearchQuery(" p ")).toBeUndefined();
    expect(buildInstanceSearchQuery("0x1A")).toContain("ECInstanceId = 0x1a");
  });

  it("matches labels case-insensitively and bounds the results", async () => {
    const found = await searchInstances(engine, "pump-");
    expect(found.map((c) => c.label).sort()).toEqual(["Pump-1", "Pump-2"]);
    expect(found[0].key.classId).toBe(fx.classIds["TestIG:Pump"]);
    expect(await searchInstances(engine, "hub-pipe", 5)).toHaveLength(5);
  });

  it("treats quotes and wildcards literally", async () => {
    expect(await searchInstances(engine, "Pump%")).toEqual([]);
    expect(await searchInstances(engine, "Pump_1")).toEqual([]);
    expect(await searchInstances(engine, "x' OR 1=1 --")).toEqual([]);
  });

  it("finds an instance by exact id", async () => {
    const found = await searchInstances(engine, fx.ids.pipeB);
    expect(found.map((c) => c.label)).toEqual(["Pipe-B"]);
  });
});
