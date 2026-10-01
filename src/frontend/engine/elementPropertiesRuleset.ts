import type { PropertySpecification, RelatedPropertiesSpecification, Ruleset } from "@itwin/presentation-common";

const allProperties: PropertySpecification = {
  name: "*",
  isDisplayed: true,
  doNotHideOtherPropertiesOnDisplayOverride: true,
};

export const ELEMENT_PROPERTIES_RULESET: Ruleset = {
  id: "imodel-explorer/ElementProperties",
  rules: [{
    ruleType: "DefaultPropertyCategoryOverride",
    specification: { id: "element-properties", label: "Element", autoExpand: true },
  }, {
    ruleType: "Content",
    specifications: [{
      specType: "SelectedNodeInstances",
      propertyOverrides: [allProperties],
      relatedProperties: ["ElementOwnsUniqueAspect", "ElementOwnsMultiAspects"].map((className): RelatedPropertiesSpecification => ({
        propertiesSource: {
          relationship: { schemaName: "BisCore", className },
          direction: "Forward",
        },
        handleTargetClassPolymorphically: true,
        relationshipMeaning: "RelatedInstance",
        autoExpand: true,
        properties: [allProperties],
      })),
    }],
  }],
};
