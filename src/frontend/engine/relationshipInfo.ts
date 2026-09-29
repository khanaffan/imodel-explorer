import type { ClassRegistry } from "./ClassRegistry";
import type { Cardinality } from "./GraphModel";

export interface ConstraintInfo {
  readonly multiplicity: string;
  readonly roleLabel: string;
  readonly polymorphic: boolean;
  readonly classes: readonly string[];
}

export interface RelationshipInfo {
  readonly className: string;
  readonly strength: "referencing" | "holding" | "embedding";
  readonly strengthDirection: "forward" | "backward";
  readonly source: ConstraintInfo;
  readonly target: ConstraintInfo;
  readonly cardinality: Cardinality;
}

// SchemaView reports an unbounded upper multiplicity as 0 (NULL in ECDb).
function formatMultiplicity(lower: number, upper: number): string {
  const up = upper <= 0 || upper >= 2147483647 ? "*" : String(upper);
  return `${lower}..${up}`;
}

const STRENGTH = ["referencing", "holding", "embedding"] as const;

/** Relationship metadata, read synchronously from the SchemaView and cached per class. */
export class RelationshipInfoCache {
  private readonly _cache = new Map<string, RelationshipInfo | undefined>();

  public constructor(private readonly _registry: ClassRegistry) { }

  public get(relClassId: string): RelationshipInfo | undefined {
    if (this._cache.has(relClassId))
      return this._cache.get(relClassId);
    const info = this._compute(relClassId);
    this._cache.set(relClassId, info);
    return info;
  }

  private _compute(relClassId: string): RelationshipInfo | undefined {
    const className = this._registry.nameOf(relClassId);
    const cls = this._registry.findClass(className);
    if (!cls || !cls.isRelationship() || !cls.source || !cls.target)
      return undefined;
    const toInfo = (c: NonNullable<typeof cls.source>): ConstraintInfo => ({
      multiplicity: formatMultiplicity(c.multiplicityLower, c.multiplicityUpper),
      roleLabel: c.roleLabel,
      polymorphic: c.polymorphic,
      classes: c.constraintClasses.map((k) => k.fullName),
    });
    const source = toInfo(cls.source);
    const target = toInfo(cls.target);
    return {
      className,
      strength: STRENGTH[cls.strength] ?? "referencing",
      strengthDirection: cls.strengthDirection === 2 ? "backward" : "forward",
      source,
      target,
      cardinality: { source: source.multiplicity, target: target.multiplicity },
    };
  }
}
