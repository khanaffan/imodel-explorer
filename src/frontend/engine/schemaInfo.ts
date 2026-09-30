import { ClassModifier, ClassType, PropertyKind, type SchemaView, SchemaViewPrimitiveType } from "@itwin/ecschema-metadata";
import { type ConstraintInfo, describeConstraint, describeStrength, type RelationshipInfo } from "./relationshipInfo";

export type ClassTypeName = "entity" | "relationship" | "struct" | "customAttribute" | "mixin" | "view";
export type PropertyKindName = "primitive" | "struct" | "primitiveArray" | "structArray" | "navigation";

export interface SchemaRef {
  readonly name: string;
  readonly alias: string;
  /** "RR.WW.mm", zero-padded like the ECXml version attribute. */
  readonly version: string;
  readonly label?: string;
  readonly description?: string;
}

export interface ClassRef {
  readonly fullName: string;
  readonly label?: string;
  readonly type: ClassTypeName;
}

export interface MixinRef extends ClassRef {
  /** Set when the mixin is not applied by the class itself: the ancestor that applies it, or the
   * mixin it is a base of. */
  readonly via?: string;
}

export interface EnumeratorInfo {
  readonly name: string;
  readonly label?: string;
  readonly value: number | string;
}

export interface PropertyDetail {
  readonly enumeration?: { readonly fullName: string; readonly isStrict: boolean; readonly enumerators: readonly EnumeratorInfo[] };
  readonly kindOfQuantity?: { readonly fullName: string; readonly persistenceUnit: string };
  readonly extendedType?: string;
  readonly arrayMin?: number;
  readonly arrayMax?: number;
  readonly structClass?: ClassRef;
  readonly relationshipClass?: ClassRef;
  readonly direction?: "forward" | "backward";
  readonly category?: string;
}

export interface PropertyInfo {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly kind: PropertyKindName;
  readonly typeText: string;
  readonly isReadOnly: boolean;
  readonly detail: PropertyDetail;
}

export interface PropertyGroup {
  readonly declaringClass: ClassRef;
  readonly isOwn: boolean;
  readonly properties: readonly PropertyInfo[];
}

export interface ClassRelationshipInfo extends Pick<RelationshipInfo, "strength" | "strengthDirection"> {
  readonly source?: ConstraintInfo;
  readonly target?: ConstraintInfo;
}

export interface SchemaClassInfo {
  readonly self: ClassRef;
  readonly modifier: "none" | "abstract" | "sealed";
  readonly description?: string;
  readonly schema: SchemaRef;
  /** Root first, ending with the class itself. */
  readonly baseChain: readonly ClassRef[];
  /** Mixins applied by the class or any ancestor, plus their base mixins; own ones first. */
  readonly mixins: readonly MixinRef[];
  readonly propertyGroups: readonly PropertyGroup[];
  readonly propertyCount: number;
  /** Direct subclasses only. Mixin implementors are not listed: SchemaView's derived-class map
   * is built from base classes alone. */
  readonly derivedClasses: readonly ClassRef[];
  readonly relationship?: ClassRelationshipInfo;
}

// The enum values are non-sequential (Binary = 257 ...), so names are mapped explicitly.
const PRIMITIVE_NAMES: ReadonlyMap<SchemaViewPrimitiveType, string> = new Map([
  [SchemaViewPrimitiveType.Binary, "binary"],
  [SchemaViewPrimitiveType.Boolean, "boolean"],
  [SchemaViewPrimitiveType.DateTime, "dateTime"],
  [SchemaViewPrimitiveType.Double, "double"],
  [SchemaViewPrimitiveType.Integer, "int"],
  [SchemaViewPrimitiveType.Long, "long"],
  [SchemaViewPrimitiveType.Point2d, "point2d"],
  [SchemaViewPrimitiveType.Point3d, "point3d"],
  [SchemaViewPrimitiveType.String, "string"],
  [SchemaViewPrimitiveType.IGeometry, "Bentley.Geometry.Common.IGeometry"],
]);

export function primitiveTypeName(t: SchemaViewPrimitiveType): string {
  return PRIMITIVE_NAMES.get(t) ?? `unknown(${t})`;
}

const CLASS_TYPES: Record<ClassType, ClassTypeName> = {
  [ClassType.Entity]: "entity",
  [ClassType.Relationship]: "relationship",
  [ClassType.Struct]: "struct",
  [ClassType.CustomAttribute]: "customAttribute",
  [ClassType.Mixin]: "mixin",
  [ClassType.View]: "view",
};

const PROPERTY_KINDS: Record<PropertyKind, PropertyKindName> = {
  [PropertyKind.Primitive]: "primitive",
  [PropertyKind.Struct]: "struct",
  [PropertyKind.PrimitiveArray]: "primitiveArray",
  [PropertyKind.StructArray]: "structArray",
  [PropertyKind.Navigation]: "navigation",
};

const pad = (n: number) => String(n).padStart(2, "0");
const opt = (s: string | undefined) => (s ? s : undefined);
const directionName = (d: number) => (d === 2 ? "backward" : "forward");

export function classRef(cls: SchemaView.Class): ClassRef {
  return { fullName: cls.fullName, label: opt(cls.label), type: CLASS_TYPES[cls.type] ?? "entity" };
}

function schemaRef(s: SchemaView.Schema): SchemaRef {
  return {
    name: s.name,
    alias: s.alias,
    version: `${pad(s.readVersion)}.${pad(s.writeVersion)}.${pad(s.minorVersion)}`,
    label: opt(s.label),
    description: opt(s.description),
  };
}

/** Array occurrence bounds as "min..max", with "*" for an unbounded maximum. */
export function formatArrayBounds(min: number | undefined, max: number | undefined): string {
  const unbounded = max === undefined || max <= 0 || max >= 2147483647;
  return `${min ?? 0}..${unbounded ? "*" : max}`;
}

/** "[]", or "[min..max]" when the bounds differ from the default 0..unbounded. */
function arraySuffix(min: number | undefined, max: number | undefined): string {
  const text = formatArrayBounds(min, max);
  return text === "0..*" ? "[]" : `[${text}]`;
}

function arrayBounds(prop: SchemaView.Property): { min?: number; max?: number } | undefined {
  if (!prop.isArray())
    return undefined;
  return { min: prop.arrayMinOccurs, max: prop.arrayMaxOccurs };
}

/** The single type string shown in the type column, e.g. "double", "TestIG:Mode (int)",
 * "string[] · URI", "-> BisCore:ModelContainsElements (backward)". */
export function formatPropertyType(prop: SchemaView.Property): string {
  if (prop.isNavigation())
    return `-> ${prop.relationshipClass.fullName} (${directionName(prop.direction)})`;
  if (prop.isStruct()) {
    const bounds = arrayBounds(prop);
    return bounds ? `${prop.structClass.fullName}${arraySuffix(bounds.min, bounds.max)}` : prop.structClass.fullName;
  }
  if (prop.isPrimitive()) {
    let text = prop.enumeration
      ? `${prop.enumeration.fullName} (${primitiveTypeName(prop.enumeration.primitiveType)})`
      : primitiveTypeName(prop.primitiveType);
    const bounds = arrayBounds(prop);
    if (bounds)
      text += arraySuffix(bounds.min, bounds.max);
    if (prop.extendedTypeName)
      text += ` · ${prop.extendedTypeName}`;
    return text;
  }
  return PROPERTY_KINDS[prop.kind] ?? "unknown";
}

function describeProperty(prop: SchemaView.Property): PropertyInfo {
  const detail: { -readonly [K in keyof PropertyDetail]: PropertyDetail[K] } = {};
  if (prop.category)
    detail.category = prop.category.fullName;
  if (prop.isNavigation()) {
    detail.relationshipClass = classRef(prop.relationshipClass);
    detail.direction = directionName(prop.direction);
  } else if (prop.isStruct()) {
    detail.structClass = classRef(prop.structClass);
  } else if (prop.isPrimitive()) {
    const p = prop;
    if (p.enumeration) {
      detail.enumeration = {
        fullName: p.enumeration.fullName,
        isStrict: p.enumeration.isStrict,
        enumerators: [...p.enumeration.getEnumerators()].map((e) => ({ name: e.name, label: opt(e.label), value: e.value })),
      };
    }
    if (p.kindOfQuantity)
      detail.kindOfQuantity = { fullName: p.kindOfQuantity.fullName, persistenceUnit: p.kindOfQuantity.persistenceUnit };
    if (p.extendedTypeName)
      detail.extendedType = p.extendedTypeName;
  }
  const bounds = arrayBounds(prop);
  if (bounds) {
    detail.arrayMin = bounds.min;
    detail.arrayMax = bounds.max;
  }
  return {
    name: prop.name,
    label: opt(prop.label) !== prop.name ? opt(prop.label) : undefined,
    description: opt(prop.description),
    kind: PROPERTY_KINDS[prop.kind] ?? "primitive",
    typeText: formatPropertyType(prop),
    isReadOnly: prop.isReadOnly,
    detail,
  };
}

const byName = (a: ClassRef, b: ClassRef) => a.fullName.localeCompare(b.fullName);

function collectMixins(cls: SchemaView.Class, chain: readonly SchemaView.Class[]): MixinRef[] {
  const out: MixinRef[] = [];
  const seen = new Set<string>();
  const add = (m: SchemaView.Class, via: string | undefined) => {
    for (let c: SchemaView.Class | undefined = m, v = via; c && !seen.has(c.fullName); v = c.fullName, c = c.baseClass) {
      seen.add(c.fullName);
      out.push({ ...classRef(c), via: v });
    }
  };
  for (const c of [...chain].reverse())
    for (const m of c.mixins)
      add(m, c === cls ? undefined : c.fullName);
  return out;
}

/** Everything the type explorer shows for one class, read synchronously from the SchemaView. */
export function describeClass(view: SchemaView, fullName: string): SchemaClassInfo | undefined {
  const cls = view.findClass(fullName);
  if (!cls)
    return undefined;

  const chain: SchemaView.Class[] = [];
  const seen = new Set<string>();
  for (let c: SchemaView.Class | undefined = cls; c && !seen.has(c.fullName); c = c.baseClass) {
    seen.add(c.fullName);
    chain.unshift(c);
  }

  // Group by declaring class: own first, then ancestors nearest first, then anything else
  // (mixin-contributed properties) in first-seen order.
  const groups = new Map<string, { cls: SchemaView.Class; props: PropertyInfo[] }>();
  for (const c of [...chain].reverse())
    groups.set(c.fullName, { cls: c, props: [] });
  const properties = cls.getProperties();
  for (const prop of properties) {
    const declaring = prop.declaringClass ?? cls;
    let g = groups.get(declaring.fullName);
    if (!g) {
      g = { cls: declaring, props: [] };
      groups.set(declaring.fullName, g);
    }
    g.props.push(describeProperty(prop));
  }
  const propertyGroups = [...groups.values()]
    .filter((g) => g.props.length > 0 || g.cls === cls)
    .map((g) => ({
      declaringClass: classRef(g.cls),
      isOwn: g.cls.fullName === cls.fullName,
      properties: g.props.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  let relationship: ClassRelationshipInfo | undefined;
  if (cls.isRelationship()) {
    relationship = {
      ...describeStrength(cls),
      source: cls.source ? describeConstraint(cls.source) : undefined,
      target: cls.target ? describeConstraint(cls.target) : undefined,
    };
  }

  return {
    self: classRef(cls),
    modifier: cls.modifier === ClassModifier.Abstract ? "abstract" : cls.modifier === ClassModifier.Sealed ? "sealed" : "none",
    description: opt(cls.description),
    schema: schemaRef(cls.schema),
    baseChain: chain.map(classRef),
    mixins: collectMixins(cls, chain),
    propertyGroups,
    propertyCount: properties.length,
    derivedClasses: cls.derivedClasses.map(classRef).sort(byName),
    relationship,
  };
}

/** Case-insensitive substring match over class full names, capped for the search dropdown. */
export function searchClassNames(names: readonly string[], text: string, limit = 50): string[] {
  const q = text.trim().toLowerCase();
  if (!q)
    return [];
  const out: string[] = [];
  for (const n of names) {
    if (n.toLowerCase().includes(q)) {
      out.push(n);
      if (out.length >= limit) break;
    }
  }
  return out;
}
