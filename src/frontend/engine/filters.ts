import type { GraphNode } from "./GraphModel";

export type FilterState = "include" | "exclude";

export interface ClassFilterEntry {
  readonly state: FilterState;
  /** Also match subclasses. */
  readonly polymorphic: boolean;
}

/** Tri-state per entry: absent = neutral. Within a dimension, any matching `exclude` removes the
 * item; if any `include` entries exist, the item must match at least one of them. */
export interface FilterSpec {
  readonly models: Readonly<Record<string, FilterState>>;
  readonly schemas: Readonly<Record<string, FilterState>>;
  readonly classes: Readonly<Record<string, ClassFilterEntry>>;
  readonly relationships: Readonly<Record<string, ClassFilterEntry>>;
}

export const EMPTY_FILTERS: FilterSpec = { models: {}, schemas: {}, classes: {}, relationships: {} };

export function isFilterEmpty(f: FilterSpec): boolean {
  return [f.models, f.schemas, f.classes, f.relationships].every((d) => Object.keys(d).length === 0);
}

function passes<T>(entries: Readonly<Record<string, T>>, stateOf: (e: T) => FilterState, matches: (name: string, e: T) => boolean): boolean {
  let hasInclude = false;
  let included = false;
  for (const [name, entry] of Object.entries(entries)) {
    const state = stateOf(entry);
    const hit = matches(name, entry);
    if (state === "exclude" && hit)
      return false;
    if (state === "include") {
      hasInclude = true;
      included ||= hit;
    }
  }
  return !hasInclude || included;
}

const sameName = (a: string, b: string) => a.replace(".", ":").toLowerCase() === b.replace(".", ":").toLowerCase();

export function classMatches(hierarchy: readonly string[], name: string, polymorphic: boolean): boolean {
  return polymorphic ? hierarchy.some((h) => sameName(h, name)) : hierarchy.length > 0 && sameName(hierarchy[0], name);
}

/** Class and schema filters, evaluated before a related instance is resolved. */
export function passesClassFilters(filters: FilterSpec, classHierarchy: readonly string[]): boolean {
  const schemaName = classHierarchy[0]?.split(":")[0] ?? "";
  return passes(filters.schemas, (s) => s, (name) => sameName(name, schemaName))
    && passes(filters.classes, (e) => e.state, (name, e) => classMatches(classHierarchy, name, e.polymorphic));
}

export function passesRelationshipFilters(filters: FilterSpec, relHierarchy: readonly string[]): boolean {
  return passes(filters.relationships, (e) => e.state, (name, e) => classMatches(relHierarchy, name, e.polymorphic));
}

/** Model filter, evaluated after resolution. Instances not contained in a model (models, aspects,
 * code specs) are unaffected. */
export function passesModelFilters(filters: FilterSpec, node: Pick<GraphNode, "modelId">): boolean {
  if (!node.modelId)
    return true;
  return passes(filters.models, (s) => s, (id) => id === node.modelId);
}

export function cycleFilterState(current: FilterState | undefined): FilterState | undefined {
  return current === undefined ? "include" : current === "include" ? "exclude" : undefined;
}
