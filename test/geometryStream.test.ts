import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GeometricElement3dProps, GeometryParams, type GeometryStreamProps, SubCategoryAppearance } from "@itwin/core-common";
import { classifyOp, describeAppearance, parseGeometryStream } from "../src/frontend/engine/geometryStream";
import { imodelFrameFacts, placementFacts, subCategoryFacts } from "../src/frontend/engine/geometryFacts";
import { Range3d } from "@itwin/core-geometry";
import { createFixture, type Fixture, PUMP1_STREAM_KEYS } from "./fixture";

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture();
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

function pump1Props(): GeometricElement3dProps {
  return fx.db.elements.getElementProps<GeometricElement3dProps>({ id: fx.ids.pump1, wantGeometry: true });
}

describe("classifyOp", () => {
  it("classifies modifiers, primitives and unknowns", () => {
    expect(classifyOp({ header: { flags: 0 } }).kind).toBe("header");
    expect(classifyOp({ appearance: {} }).kind).toBe("appearance");
    expect(classifyOp({ subRange: { low: [0, 0, 0], high: [1, 1, 1] } } as never).kind).toBe("subRange");
    expect(classifyOp({ geomPart: { part: "0x42" } }).kind).toBe("partReference");
    expect(classifyOp({ box: {} } as never).kind).toBe("geometry");
    expect(classifyOp({ lineString: [] } as never).kind).toBe("geometry");
    expect(classifyOp({ noSuchOp: {} } as never).kind).toBe("unknown");
  });
});

describe("parseGeometryStream on the fixture element", () => {
  it("shows every raw op in stream order", () => {
    const props = pump1Props();
    const parsed = parseGeometryStream(props.geom!, { kind: "element3d", placement: props.placement, category: props.category });
    expect(parsed.ops.map((op) => Object.keys(op.raw)[0])).toEqual([...PUMP1_STREAM_KEYS]);
    expect(parsed.summary.totalOps).toBe(PUMP1_STREAM_KEYS.length);
  });

  it("formats primitives with their geometry type and facts", () => {
    const props = pump1Props();
    const parsed = parseGeometryStream(props.geom!, { kind: "element3d", placement: props.placement, category: props.category });
    const labels = parsed.ops.filter((op) => op.isPrimitive).map((op) => op.label);
    expect(labels).toContain("Box");
    expect(labels).toContain("Line string");
    expect(labels).toContain("Arc");
    expect(labels).toContain("Part reference");
    expect(labels).toContain("Text");
    const box = parsed.ops.find((op) => op.label === "Box")!;
    expect(box.facts.some((f) => f.name === "Base origin")).toBe(true);
    expect(box.localRange).toBeDefined();
    const ls = parsed.ops.find((op) => op.label === "Line string")!;
    expect(ls.counts?.points).toBe(3);
  });

  it("resolves appearance per primitive, including the Trim override and the reset", () => {
    const props = pump1Props();
    const parsed = parseGeometryStream(props.geom!, { kind: "element3d", placement: props.placement, category: props.category });
    const box = parsed.ops.find((op) => op.label === "Box")!;
    expect(box.appearance?.subCategoryId).toBe(fx.ids.trimSubCat);
    expect(box.appearance?.color).toBe("#ff0000"); // lineColor override set in the fixture
    const arc = parsed.ops.find((op) => op.label === "Arc")!;
    expect(arc.appearance?.subCategoryId).not.toBe(fx.ids.trimSubCat);
  });

  it("collects referenced parts and keeps the reference's resolved params", () => {
    const props = pump1Props();
    const parsed = parseGeometryStream(props.geom!, { kind: "element3d", placement: props.placement, category: props.category });
    expect(parsed.parts).toEqual([fx.ids.geomPart]);
    const ref = parsed.ops.find((op) => op.kind === "partReference")!;
    expect(ref.partId).toBe(fx.ids.geomPart);
    expect(ref.facts.find((f) => f.name === "Part")?.reference).toEqual({ id: fx.ids.geomPart, targetBaseClass: "BisCore:GeometryPart" });
    expect(ref.partParams).toBeDefined();
    expect(ref.partToWorld).toBeDefined();
  });

  describe("geometry reference metadata", () => {
    it("links known appearance references but not numbers, colours or fonts", () => {
      const params = new GeometryParams(fx.ids.category, fx.ids.trimSubCat);
      const baseline = new SubCategoryAppearance({ style: "0x42", material: "0x43" });
      for (const facts of [describeAppearance(params, baseline), subCategoryFacts(baseline, fx.ids.trimSubCat)]) {
        expect(facts.find((f) => f.name === "Sub-category")?.reference).toEqual({ id: fx.ids.trimSubCat, targetBaseClass: "BisCore:SubCategory" });
        expect(facts.find((f) => f.name === "Material")?.reference).toEqual({ id: "0x43", targetBaseClass: "BisCore:RenderMaterial" });
        expect(facts.find((f) => f.name === "Style" || f.name === "Line style")?.reference).toEqual({ id: "0x42", targetBaseClass: "BisCore:LineStyle" });
        expect(facts.find((f) => f.name === "Weight")?.reference).toBeUndefined();
        expect(facts.find((f) => f.name === "Colour")?.reference).toBeUndefined();
      }
    });
  });

  it("parses a part stream with fromGeometryPart context", () => {
    const part = fx.db.elements.getElementProps<GeometricElement3dProps>({ id: fx.ids.geomPart, wantGeometry: true });
    const parsed = parseGeometryStream(part.geom!, { kind: "part" });
    expect(parsed.ops.filter((op) => op.isPrimitive).map((op) => op.label)).toEqual(["Box", "Arc"]);
  });

  it("marks a bogus geometry entry as not parsed without derailing later ops", () => {
    const props = pump1Props();
    const stream: GeometryStreamProps = [...props.geom!];
    // Splice a syntactically geometric but unparseable entry ahead of the real geometry.
    stream.splice(1, 0, { box: { baseOrigin: "nonsense" } } as never);
    const parsed = parseGeometryStream(stream, { kind: "element3d", placement: props.placement, category: props.category });
    const bogus = parsed.ops[1];
    expect(bogus.notParsed).toBe(true);
    // The real primitives after it still reconcile with the iterator.
    const box = parsed.ops.find((op) => op.label === "Box");
    expect(box).toBeDefined();
    expect(box!.appearance?.subCategoryId).toBe(fx.ids.trimSubCat);
  });

  it("summarises counts by kind", () => {
    const props = pump1Props();
    const parsed = parseGeometryStream(props.geom!, { kind: "element3d", placement: props.placement, category: props.category });
    expect(parsed.summary.byKind.get("geometry")).toBe(3); // box, lineString, arc
    expect(parsed.summary.byKind.get("appearance")).toBe(2);
    expect(parsed.summary.byKind.get("partReference")).toBe(1);
    expect(parsed.summary.primitives).toBe(5);
    expect(parsed.summary.distinctParts).toBe(1);
    expect(parsed.summary.hasBRep).toBe(false);
  });
});

describe("placementFacts", () => {
  it("describes the fixture placement: origin, yaw, bbox, world range and transform", () => {
    const props = pump1Props();
    const p = placementFacts(props.placement)!;
    const byName = new Map(p.facts.map((f) => [f.name, f.value]));
    expect(byName.get("Origin")).toBe("(1, 2, 0)");
    expect(byName.get("Rotation")).toContain("yaw 30°");
    expect(byName.get("Local bbox")).toBeDefined();
    expect(byName.get("World range")).toBeDefined();
    expect(p.worldRange!.isNull).toBe(false);
    expect(p.transform.isIdentity).toBe(false);
  });

  it("handles a 2d placement", () => {
    const p = placementFacts({ origin: [5, 6], angle: 45 })!;
    const byName = new Map(p.facts.map((f) => [f.name, f.value]));
    expect(byName.get("Origin")).toBe("(5, 6)");
    expect(byName.get("Rotation")).toBe("45.00°");
  });

  it("returns undefined without placement props", () => {
    expect(placementFacts(undefined)).toBeUndefined();
  });
});

describe("imodelFrameFacts", () => {
  it("reports extents, origin and geolocation", () => {
    const facts = imodelFrameFacts({
      projectExtents: Range3d.createXYZXYZ(0, 0, 0, 100, 50, 10),
      globalOrigin: { toJSON: () => [0, 0, 0] },
      isGeoLocated: false,
    });
    const byName = new Map(facts.map((f) => [f.name, f.value]));
    expect(byName.get("Project extents")).toBe("(0, 0, 0) to (100, 50, 10)");
    expect(byName.get("Extents size")).toBe("100 × 50 × 10");
    expect(byName.get("Geolocated")).toBe("false");
  });
});
