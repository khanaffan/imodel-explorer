import { PresentationManager } from "@itwin/presentation-backend";
import { Code } from "@itwin/core-common";
import { ContentFlags, type Content, type Field, KeySet, type Ruleset, Value } from "@itwin/presentation-common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ELEMENT_PROPERTIES_RULESET } from "../src/frontend/engine/elementPropertiesRuleset";
import { createFixture, type Fixture } from "./fixture";

const schema = `<?xml version="1.0" encoding="UTF-8"?>
<ECSchema schemaName="PropertyTest" alias="pt" version="01.00.00" xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.2">
  <ECSchemaReference name="TestIG" version="01.00.00" alias="tig"/>
  <ECSchemaReference name="BisCore" version="01.00.00" alias="bis"/>
  <ECSchemaReference name="CoreCustomAttributes" version="01.00.00" alias="cca"/>
  <ECStructClass typeName="Details">
    <ECProperty propertyName="Count" typeName="int"/>
  </ECStructClass>
  <ECEntityClass typeName="Pump">
    <BaseClass>tig:Pump</BaseClass>
    <ECProperty propertyName="HiddenValue" typeName="string">
      <ECCustomAttributes><HiddenProperty xmlns="CoreCustomAttributes.01.00.00"><Show>false</Show></HiddenProperty></ECCustomAttributes>
    </ECProperty>
    <ECProperty propertyName="EmptyValue" typeName="string"/>
    <ECArrayProperty propertyName="Tags" typeName="string"/>
    <ECStructProperty propertyName="Details" typeName="Details"/>
  </ECEntityClass>
  <ECEntityClass typeName="DetailAspect">
    <BaseClass>bis:ElementUniqueAspect</BaseClass>
    <ECProperty propertyName="HiddenAspectValue" typeName="string">
      <ECCustomAttributes><HiddenProperty xmlns="CoreCustomAttributes.01.00.00"><Show>false</Show></HiddenProperty></ECCustomAttributes>
    </ECProperty>
  </ECEntityClass>
  <ECEntityClass typeName="CheckAspect">
    <BaseClass>bis:ElementMultiAspect</BaseClass>
    <ECProperty propertyName="Note" typeName="string"/>
  </ECEntityClass>
</ECSchema>`;

const minimalRuleset: Ruleset = {
  id: "test/MinimalPropertyGrid",
  rules: [{ ruleType: "Content", specifications: [{ specType: "SelectedNodeInstances" }] }],
};
let fx: Fixture;
let manager: PresentationManager;
let elementId: string;

function fieldsOf(fields: readonly Field[]): Field[] {
  return fields.flatMap((field) => [field, ...(field.isNestedContentField() ? fieldsOf(field.nestedFields) : [])]);
}

function fieldFor(content: Content, propertyName: string): Field | undefined {
  return fieldsOf(content.descriptor.fields).find((field) => field.isPropertiesField()
    && field.properties.some((p) => p.property.name === propertyName));
}

function valuesFor(content: Content, propertyName: string): Value[] {
  const collect = (fields: readonly Field[], values: Record<string, Value>): Value[] => fields.flatMap((field) => {
    const value = values[field.name];
    if (field.isNestedContentField() && Value.isNestedContent(value))
      return value.flatMap((item) => collect(field.nestedFields, item.values));
    return field.isPropertiesField() && field.properties.some((p) => p.property.name === propertyName) ? [value] : [];
  });
  return content.contentSet.flatMap((item) => collect(content.descriptor.fields, item.values));
}

async function contentFor(ruleset: Ruleset, id = elementId, className = "PropertyTest:Pump"): Promise<Content> {
  const content = await manager.getContent({
    imodel: fx.db, rulesetOrId: ruleset, keys: new KeySet([{ className, id }]),
    descriptor: { displayType: "PropertyPane", contentFlags: ContentFlags.ShowLabels | ContentFlags.MergeResults },
  });
  if (!content) throw new Error("Presentation returned no property content");
  return content;
}

beforeAll(async () => {
  fx = await createFixture();
  await fx.db.importSchemaStrings([schema]);
  const element = {
    classFullName: "PropertyTest:Pump", model: fx.ids.plantA, category: fx.ids.category, code: Code.createEmpty(), userLabel: "Properties test",
    hiddenValue: "schema-hidden data", tags: ["one", "two"], details: { count: 3 },
  };
  elementId = fx.db.elements.insertElement(element);
  const uniqueAspect = {
    classFullName: "PropertyTest:DetailAspect",
    element: { id: elementId, relClassName: "BisCore:ElementOwnsUniqueAspect" },
    hiddenAspectValue: "aspect-hidden data",
  };
  fx.db.elements.insertAspect(uniqueAspect);
  for (const note of ["first", "second"]) {
    const multiAspect = {
      classFullName: "PropertyTest:CheckAspect",
      element: { id: elementId, relClassName: "BisCore:ElementOwnsMultiAspects" }, note,
    };
    fx.db.elements.insertAspect(multiAspect);
  }
  fx.db.saveChanges();
  manager = new PresentationManager();
});

afterAll(async () => { manager?.[Symbol.dispose](); await fx?.close(); });

describe("element property Presentation rules", () => {
  it("reproduces schema-hidden omissions while retaining standard supplemental aspect content", async () => {
    const content = await contentFor(minimalRuleset);
    expect(fieldFor(content, "HiddenValue")).toBeUndefined();
    expect(fieldFor(content, "HiddenAspectValue")).toBeUndefined();
    expect(valuesFor(content, "Note").sort()).toEqual(["first", "second"]);
    const original = await contentFor(minimalRuleset, fx.ids.pump1, "TestIG:Pump");
    expect(valuesFor(original, "RatedPower")).toEqual([7.5]);
  });

  it("returns hidden, empty, inherited, array and struct properties", async () => {
    const content = await contentFor(ELEMENT_PROPERTIES_RULESET);
    expect(valuesFor(content, "HiddenValue")).toEqual(["schema-hidden data"]);
    expect(fieldFor(content, "EmptyValue")).toBeDefined();
    expect(fieldFor(content, "UserLabel")).toBeDefined();
    expect(valuesFor(content, "Tags")).toEqual([["one", "two"]]);
    expect(valuesFor(content, "Details")).toEqual([{ Count: 3 }]);
  });

  it("returns concrete unique/multi-aspect properties without merging separate aspect instances", async () => {
    const content = await contentFor(ELEMENT_PROPERTIES_RULESET);
    expect(valuesFor(content, "HiddenAspectValue")).toEqual(["aspect-hidden data"]);
    expect(valuesFor(content, "Note").sort()).toEqual(["first", "second"]);
    const original = await contentFor(ELEMENT_PROPERTIES_RULESET, fx.ids.pump1, "TestIG:Pump");
    expect(valuesFor(original, "RatedPower")).toEqual([7.5]);
  });
});
