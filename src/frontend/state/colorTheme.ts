import type { GraphNode, NodeCategory } from "../engine/GraphModel";
import { classMatches } from "../engine/filters";

export interface ColorRule {
  readonly id: string;
  /** `Schema:Class` or a bare schema name. */
  readonly match: string;
  readonly kind: "class" | "schema";
  readonly polymorphic: boolean;
  readonly color: string;
}

export interface ColorTheme {
  readonly categories: Readonly<Record<NodeCategory, string>>;
  /** Evaluated in order; the first match wins over the category colour. */
  readonly rules: readonly ColorRule[];
}

export const CATEGORY_LABELS: Readonly<Record<NodeCategory, string>> = {
  geometric3d: "3D geometric element",
  geometric2d: "2D geometric element",
  definition: "Definition element",
  information: "Information element",
  role: "Role element",
  model: "Model",
  aspect: "Element aspect",
  other: "Other",
};

export const DEFAULT_THEME: ColorTheme = {
  categories: {
    geometric3d: "#2f80ed",
    geometric2d: "#56ccf2",
    definition: "#9b51e0",
    information: "#27ae60",
    role: "#f2994a",
    model: "#eb5757",
    aspect: "#bdbdbd",
    other: "#828282",
  },
  rules: [],
};

const STORAGE_KEY = "instanceGraph.colorTheme";

export function colorFor(node: Pick<GraphNode, "category" | "classHierarchy" | "schemaName">, theme: ColorTheme): string {
  for (const r of theme.rules) {
    const hit = r.kind === "schema"
      ? node.schemaName.toLowerCase() === r.match.toLowerCase()
      : classMatches(node.classHierarchy, r.match, r.polymorphic);
    if (hit)
      return r.color;
  }
  return theme.categories[node.category] ?? theme.categories.other;
}

export function loadTheme(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ColorTheme {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ColorTheme>;
    return {
      categories: { ...DEFAULT_THEME.categories, ...parsed.categories },
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ColorTheme, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(theme));
}

/** Readable text colour for a given background. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111" : "#fff";
}
