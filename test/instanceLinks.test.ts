import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS, GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource, type Row } from "../src/frontend/engine/IModelQueryPort";
import { resolveInstanceReferenceClassId } from "../src/frontend/engine/instanceProperties";
import { graphActions, useGraphStore } from "../src/frontend/state/graphStore";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let engine: GraphEngine;
const initialState = useGraphStore.getState();
beforeAll(async () => {
  fx = await createFixture();
  engine = await GraphEngine.create(createQueryPort(fx.db as unknown as QuerySource), "relations");
});
beforeEach(async () => {
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
  useGraphStore.setState({ ...initialState, engine, options: { ...DEFAULT_OPTIONS, depth: 1 } });
  await graphActions.centreOn({ id: fx.ids.pump1, classId: fx.classIds["TestIG:Pump"] });
});
afterEach(() => {
  graphActions.detach();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useGraphStore.setState(initialState, true);
});
afterAll(async () => fx?.close());

describe("instance reference navigation", () => {
  it("resolves concrete part, category and sub-category classes", async () => {
    for (const [id, baseClass, concreteClass] of [
      [fx.ids.geomPart, "BisCore:GeometryPart", "BisCore:GeometryPart"],
      [fx.ids.category, "BisCore:Category", "BisCore:SpatialCategory"],
      [fx.ids.trimSubCat, "BisCore:SubCategory", "BisCore:SubCategory"],
    ]) {
      const reference = { id, targetBaseClass: baseClass };
      expect(await resolveInstanceReferenceClassId(engine.port, reference)).toBe(engine.registry.idOf(concreteClass));
      await graphActions.centreOnReference(reference);
      const state = useGraphStore.getState();
      expect(state.status.kind).toBe("idle");
      expect(state.graph.nodes.get(state.graph.centreKey)?.className).toBe(concreteClass);
      expect(state.graph.nodes.get(state.graph.centreKey)?.id).toBe(id);
    }
  });

  it("navigates to a model rather than the element sharing its id, with Back preserved", async () => {
    const before = useGraphStore.getState().graph.centreKey;
    await graphActions.centreOnReference({ id: fx.ids.plantA, targetBaseClass: "BisCore:Model" });
    const state = useGraphStore.getState();
    expect(state.status.kind).toBe("idle");
    expect(state.graph.nodes.get(state.graph.centreKey)?.className).toBe("BisCore:PhysicalModel");
    graphActions.back();
    expect(useGraphStore.getState().graph.centreKey).toBe(before);
  });

  it("reports missing, wrong-class and invalid references without changing the graph", async () => {
    const before = useGraphStore.getState().graph;
    for (const reference of [
      { id: "0xffffffffff", targetBaseClass: "BisCore:Element" },
      { id: fx.ids.pump1, targetBaseClass: "BisCore:GeometryPart" },
      { id: "not-an-id" },
    ]) {
      await graphActions.centreOnReference(reference);
      expect(useGraphStore.getState().status.kind).toBe("error");
      expect(useGraphStore.getState().graph).toBe(before);
    }
  });

  it("surfaces lookup failures instead of trying a different instance class", async () => {
    const before = useGraphStore.getState().graph;
    vi.spyOn(engine.port, "query").mockRejectedValueOnce(new Error("reference query failed"));
    await graphActions.centreOnReference({ id: fx.ids.plantA, targetBaseClass: "BisCore:Model" });
    expect(useGraphStore.getState().status).toEqual({ kind: "error", message: "reference query failed" });
    expect(useGraphStore.getState().graph).toBe(before);
  });

  it("does not allow a reference link to bypass instance exclusions", async () => {
    const classId = engine.registry.idOf("BisCore:GeometryPart")!;
    useGraphStore.setState({ options: { ...DEFAULT_OPTIONS, excludedInstances: [`${classId}:${fx.ids.geomPart}`] } });
    const before = useGraphStore.getState().graph.centreKey;
    await graphActions.centreOnReference({ id: fx.ids.geomPart, classId });
    expect(useGraphStore.getState().status.kind).toBe("error");
    expect(useGraphStore.getState().graph.centreKey).toBe(before);
  });

  it("does not let a delayed reference lookup supersede a newer navigation", async () => {
    let finishLookup!: (rows: Row[]) => void;
    vi.spyOn(engine.port, "query").mockImplementationOnce(() => new Promise((resolve) => { finishLookup = resolve; }));
    const pending = graphActions.centreOnReference({ id: fx.ids.geomPart, targetBaseClass: "BisCore:GeometryPart" });
    await graphActions.centreOn({ id: fx.ids.pump2, classId: fx.classIds["TestIG:Pump"] });
    finishLookup([{ ECClassId: engine.registry.idOf("BisCore:GeometryPart") }]);
    await pending;
    expect(useGraphStore.getState().graph.centreKey).toBe(`${fx.classIds["TestIG:Pump"]}:${fx.ids.pump2}`);
    expect(useGraphStore.getState().status.kind).toBe("idle");
  });
});
