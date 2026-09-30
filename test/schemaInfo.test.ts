import type { SchemaView } from "@itwin/ecschema-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { describeClass, formatPropertyType, searchClassNames, type SchemaClassInfo } from "../src/frontend/engine/schemaInfo";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let view: SchemaView;

beforeAll(async () => {
  fx = await createFixture();
  view = await createQueryPort(fx.db as unknown as QuerySource).getSchemaView();
});

afterAll(async () => fx?.close());

const describe_ = (name: string): SchemaClassInfo => {
  const info = describeClass(view, name);
  if (!info) throw new Error(`${name} not found`);
  return info;
};
const prop = (info: SchemaClassInfo, name: string) =>
  info.propertyGroups.flatMap((g) => g.properties).find((p) => p.name === name)!;

describe("describeClass", () => {
  it("returns undefined for an unknown class", () => {
    expect(describeClass(view, "TestIG:NoSuchClass")).toBeUndefined();
  });

  it("reports the schema with a padded version and alias", () => {
    const info = describe_("TestIG:SmartPump");
    expect(info.schema).toMatchObject({ name: "TestIG", alias: "tig", version: "01.00.00" });
    expect(info.self).toMatchObject({ fullName: "TestIG:SmartPump", type: "entity" });
    expect(info.description).toBe("A pump with telemetry");
    expect(info.modifier).toBe("none");
  });

  it("walks the base chain root-first and lists mixins", () => {
    const info = describe_("TestIG:SmartPump");
    const chain = info.baseChain.map((c) => c.fullName);
    expect(chain[0]).toBe("BisCore:Element");
    expect(chain.slice(-3)).toEqual(["BisCore:PhysicalElement", "TestIG:Pump", "TestIG:SmartPump"]);
    expect(info.mixins).toEqual([expect.objectContaining({ fullName: "TestIG:IMonitored", type: "mixin" })]);
    expect(describe_("TestIG:IMonitored").modifier).toBe("abstract");
  });

  it("lists inherited mixins and base mixins, own first", () => {
    const mixins = describe_("TestIG:SmartPumpMk2").mixins;
    expect(mixins.map((m) => [m.fullName, m.via])).toEqual([
      ["TestIG:ICalibrated", undefined],
      ["TestIG:IAudited", "TestIG:ICalibrated"],
      ["TestIG:IMonitored", "TestIG:SmartPump"],
    ]);
    expect(describe_("TestIG:SmartPump").mixins.map((m) => m.via)).toEqual([undefined]);
  });

  it("groups properties own-first, then by declaring ancestor", () => {
    const info = describe_("TestIG:SmartPump");
    expect(info.propertyGroups[0]).toMatchObject({ isOwn: true, declaringClass: { fullName: "TestIG:SmartPump" } });
    expect(info.propertyGroups[0].properties.map((p) => p.name)).toEqual(["Manual", "Mode", "Nameplate", "Ratings", "Tags"]);
    const declaring = info.propertyGroups.map((g) => g.declaringClass.fullName);
    expect(declaring).toContain("BisCore:Element");
    expect(declaring).toContain("TestIG:IMonitored");
    // Ancestors appear nearest first; empty ancestors (Pump declares nothing) are omitted.
    expect(declaring).not.toContain("TestIG:Pump");
    expect(declaring.indexOf("BisCore:GeometricElement3d")).toBeLessThan(declaring.indexOf("BisCore:Element"));
    expect(info.propertyCount).toBe(info.propertyGroups.reduce((n, g) => n + g.properties.length, 0));
  });

  it("keeps an own group for classes that declare nothing", () => {
    const info = describe_("TestIG:Pump");
    expect(info.propertyGroups[0]).toMatchObject({ isOwn: true, properties: [] });
  });

  it("lists direct derived classes", () => {
    expect(describe_("TestIG:Pump").derivedClasses.map((c) => c.fullName)).toEqual(["TestIG:SmartPump"]);
    expect(describe_("TestIG:SmartPumpMk2").derivedClasses).toEqual([]);
  });

  it("describes relationship strength and constraints", () => {
    const info = describe_("TestIG:PumpFeedsPipe");
    expect(info.self.type).toBe("relationship");
    expect(info.modifier).toBe("sealed");
    expect(info.relationship).toMatchObject({
      strength: "referencing",
      strengthDirection: "forward",
      source: { multiplicity: "0..*", roleLabel: "feeds", polymorphic: true, classes: ["TestIG:Pump"] },
      target: { multiplicity: "0..*", classes: ["TestIG:Pipe"] },
    });
    expect(prop(info, "FlowRate").typeText).toBe("double");
    expect(describe_("TestIG:Pump").relationship).toBeUndefined();
  });
});

describe("property types", () => {
  it("formats every property kind", () => {
    const info = describe_("TestIG:SmartPump");
    expect(prop(info, "Mode").typeText).toBe("TestIG:PumpMode (int)");
    expect(prop(info, "Manual").typeText).toBe("string · URI");
    expect(prop(info, "Tags").typeText).toBe("string[]");
    expect(prop(info, "Nameplate").typeText).toBe("TestIG:Rating");
    expect(prop(info, "Ratings").typeText).toBe("TestIG:Rating[1..4]");
    expect(prop(info, "SensorId").typeText).toBe("string");
    expect(prop(info, "Model").typeText).toBe("-> BisCore:ModelContainsElements (backward)");
    expect(prop(info, "LastMod").typeText).toBe("dateTime");
  });

  it("exposes property details", () => {
    const info = describe_("TestIG:SmartPump");
    expect(prop(info, "Mode")).toMatchObject({ kind: "primitive" });
    expect(prop(info, "Mode").detail.enumeration).toEqual({
      fullName: "TestIG:PumpMode",
      isStrict: true,
      enumerators: [{ name: "Off", label: "Off", value: 0 }, { name: "Auto", label: "Automatic", value: 1 }],
    });
    expect(prop(info, "Manual")).toMatchObject({ isReadOnly: true, detail: { extendedType: "URI" } });
    expect(prop(info, "Ratings")).toMatchObject({ kind: "structArray", detail: { arrayMin: 1, arrayMax: 4, structClass: { fullName: "TestIG:Rating", type: "struct" } } });
    expect(prop(info, "Tags").kind).toBe("primitiveArray");
    expect(prop(info, "Model").detail).toMatchObject({ relationshipClass: { fullName: "BisCore:ModelContainsElements", type: "relationship" }, direction: "backward" });
  });

  it("formatPropertyType agrees with the view model", () => {
    const cls = view.findClass("TestIG:Pipe")!;
    expect(formatPropertyType(cls.getProperty("OwnerPump")!)).toBe("-> TestIG:PumpOwnsPipes (backward)");
  });
});

describe("searchClassNames", () => {
  const names = ["BisCore:Element", "TestIG:Pump", "TestIG:SmartPump", "TestIG:Pipe"];
  it("matches case-insensitively and caps results", () => {
    expect(searchClassNames(names, "pump")).toEqual(["TestIG:Pump", "TestIG:SmartPump"]);
    expect(searchClassNames(names, "  ")).toEqual([]);
    expect(searchClassNames(names, "test", 2)).toHaveLength(2);
  });
});
