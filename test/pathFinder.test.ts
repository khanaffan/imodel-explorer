import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, DEFAULT_PATH_LIMITS, GraphEngine, type PathResult, TraversalCancelled, type TraversalOptions } from "../src/frontend/engine/GraphEngine";
import { nodeKeyString } from "../src/frontend/engine/GraphModel";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { EMPTY_FILTERS, type FilterSpec } from "../src/frontend/engine/filters";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let engines: Record<"relations" | "fallback", GraphEngine>;

beforeAll(async () => {
  fx = await createFixture();
  const port = createQueryPort(fx.db as unknown as QuerySource);
  engines = { relations: await GraphEngine.create(port, "relations"), fallback: await GraphEngine.create(port, "fallback") };
});
afterAll(async () => fx?.close());

const key = (cls: string, id: string) => ({ classId: fx.classIds[`TestIG:${cls}`], id });
const only = (...rels: string[]): FilterSpec => ({
  ...EMPTY_FILTERS, relationships: Object.fromEntries(rels.map((r) => [`TestIG:${r}`, { state: "include", polymorphic: false }])),
});
const opts = (o: Partial<TraversalOptions> = {}): TraversalOptions => ({ ...DEFAULT_OPTIONS, ...o });
const pathKeys = (r: PathResult) => (r.kind === "found" ? [...r.graph.nodes.values()].sort((a, b) => a.depth - b.depth).map((n) => n.key) : []);

describe.each(["relations", "fallback"] as const)("findPath (%s)", (name) => {
  const engine = () => engines[name];

  it("finds the shortest path within the relationship filters, ordered from the start", async () => {
    const r = await engine().findPath(key("Pump", fx.ids.pump1), key("Pump", fx.ids.pump2), opts({ filters: only("PumpFeedsPipe") }));
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    expect(r.hops).toBe(2);
    expect(pathKeys(r)).toEqual([key("Pump", fx.ids.pump1), key("Pipe", fx.ids.pipeA), key("Pump", fx.ids.pump2)].map(nodeKeyString));
    expect(r.graph.centreKey).toBe(nodeKeyString(key("Pump", fx.ids.pump1)));
    expect([...r.graph.edges.values()].every((e) => e.relClassName === "TestIG:PumpFeedsPipe")).toBe(true);
  });

  it("routes around excluded instances and reports when none is left", async () => {
    const excludedInstances = [nodeKeyString(key("Pipe", fx.ids.pipeA))];
    const around = await engine().findPath(key("Pump", fx.ids.pump1), key("Pump", fx.ids.pump2), opts({ filters: only("PumpFeedsPipe", "PumpOwnsPipes"), excludedInstances }));
    expect(pathKeys(around)).toEqual([key("Pump", fx.ids.pump1), key("Pipe", fx.ids.pipeB), key("Pump", fx.ids.pump2)].map(nodeKeyString));
    const none = await engine().findPath(key("Pump", fx.ids.pump1), key("Pump", fx.ids.pump2), opts({ filters: only("PumpFeedsPipe"), excludedInstances }));
    expect(none).toMatchObject({ kind: "none", reason: "exhausted" });
  });

  it("honours direction, hop limits and exclusion of an endpoint", async () => {
    const forward = await engine().findPath(key("Pump", fx.ids.pump1), key("Pump", fx.ids.pump2), opts({ filters: only("PumpFeedsPipe"), direction: "forward" }));
    expect(forward.kind).toBe("none");
    const short = await engine().findPath(key("Pump", fx.ids.pump1), key("Pump", fx.ids.pump2), opts({ filters: only("PumpFeedsPipe") }), { ...DEFAULT_PATH_LIMITS, maxHops: 1 });
    expect(short).toMatchObject({ kind: "none", reason: "hops" });
    await expect(engine().findPath(key("Pump", fx.ids.pump1), key("Pipe", fx.ids.pipeA), opts({ excludedInstances: [nodeKeyString(key("Pipe", fx.ids.pipeA))] })))
      .rejects.toThrow(/excluded/);
  });

  it("crosses a hub and can be cancelled", async () => {
    const [a, b] = fx.ids.hubPipes;
    const r = await engine().findPath(key("Pipe", a), key("Pipe", b), opts({ filters: only("PumpFeedsPipe") }));
    expect(pathKeys(r)).toEqual([key("Pipe", a), key("Pump", fx.ids.hub), key("Pipe", b)].map(nodeKeyString));
    await expect(engine().findPath(key("Pipe", a), key("Pipe", b), opts(), DEFAULT_PATH_LIMITS, { cancelled: true })).rejects.toBeInstanceOf(TraversalCancelled);
  });
});
