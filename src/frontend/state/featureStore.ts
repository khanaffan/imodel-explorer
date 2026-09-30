/** Optional-feature switches. The core experience (open iModel, seed query, instance graph,
 * filters, properties, viewport) cannot be disabled; everything here is an optional extra that
 * costs queries or screen space. Choices persist globally (per installation) in localStorage. */
import { create } from "zustand";

export type FeatureId =
  | "overview"
  | "overview.relationships"
  | "overview.models"
  | "overview.treemap"
  | "classGraph"
  | "classGraph.imodel"
  | "schema"
  | "geometry"
  | "geometry.brep"
  | "geometry.overlay"
  | "visibilityTrees"
  | "legend"
  | "sessions"
  | "ranking";

export interface FeatureDef {
  readonly id: FeatureId;
  readonly label: string;
  readonly parent?: FeatureId;
  readonly description: string;
  readonly defaultEnabled: boolean;
}

/** Order defines the settings tree; children must follow their parent. */
export const FEATURES: readonly FeatureDef[] = [
  { id: "overview", label: "Overview", description: "iModel report: class census and totals run when the panel opens.", defaultEnabled: true },
  { id: "overview.relationships", label: "Relationship census", parent: "overview", description: "Counts every relationship class.", defaultEnabled: true },
  { id: "overview.models", label: "Model breakdown", parent: "overview", description: "Per-model element counts.", defaultEnabled: true },
  { id: "overview.treemap", label: "Treemap", parent: "overview", description: "Derived from the census; no extra query.", defaultEnabled: true },
  { id: "classGraph", label: "Class graph", description: "The Classes mode of the graph pane.", defaultEnabled: true },
  { id: "classGraph.imodel", label: "Whole-iModel class graph", parent: "classGraph", description: "Scans all classes and relationships in the iModel.", defaultEnabled: true },
  { id: "schema", label: "Schema view", description: "Schema panel and the class links that open it.", defaultEnabled: true },
  { id: "geometry", label: "Geometry stream view", description: "Loads the selected element's geometry stream.", defaultEnabled: true },
  { id: "geometry.brep", label: "Include BRep data", parent: "geometry", description: "Fetches raw BRep bytes with the stream.", defaultEnabled: false },
  { id: "geometry.overlay", label: "Range & axes overlay", parent: "geometry", description: "Draws placement box and axes in the viewport.", defaultEnabled: false },
  { id: "visibilityTrees", label: "Models & categories", description: "Model/category trees; classification queries run when shown.", defaultEnabled: true },
  { id: "legend", label: "Legend & colours", description: "Colour legend and custom colour rules.", defaultEnabled: true },
  { id: "sessions", label: "Sessions", description: "Save and restore graph sessions.", defaultEnabled: true },
  { id: "ranking", label: "Exemplar ranking", description: "\u201cRank by connections\u201d in the seed panel (on demand).", defaultEnabled: true },
];

const byId = new Map<FeatureId, FeatureDef>(FEATURES.map((f) => [f.id, f]));

export const STORAGE_KEY = "instanceGraph.features.v1";

export type FeatureMap = Readonly<Record<FeatureId, boolean>>;

export const DEFAULT_FEATURES: FeatureMap = Object.fromEntries(FEATURES.map((f) => [f.id, f.defaultEnabled])) as Record<FeatureId, boolean>;

/** A feature is effective only when it and all of its ancestors are switched on; a disabled
 * parent makes children inactive but their saved choices are preserved. */
export function featureEnabled(id: FeatureId, map: FeatureMap): boolean {
  for (let def = byId.get(id); def; def = def.parent ? byId.get(def.parent) : undefined) {
    if (!map[def.id]) return false;
  }
  return true;
}

export function loadFeatures(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): FeatureMap {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FEATURES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_FEATURES;
    const result = { ...DEFAULT_FEATURES } as Record<FeatureId, boolean>;
    for (const f of FEATURES) {
      const v = (parsed as Record<string, unknown>)[f.id];
      if (typeof v === "boolean") result[f.id] = v;
    }
    return result;
  } catch {
    return DEFAULT_FEATURES;
  }
}

export function saveFeatures(map: FeatureMap, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): string | undefined {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(map));
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface FeatureState {
  readonly features: FeatureMap;
  /** Surfaced in the settings dialog when persisting fails (e.g. storage quota). */
  readonly storageError?: string;
  readonly settingsOpen: boolean;
}

export const useFeatureStore = create<FeatureState>(() => ({
  features: loadFeatures(),
  settingsOpen: false,
}));

export const featureActions = {
  setEnabled(id: FeatureId, enabled: boolean): void {
    const features = { ...useFeatureStore.getState().features, [id]: enabled };
    useFeatureStore.setState({ features, storageError: saveFeatures(features) });
  },

  resetDefaults(): void {
    useFeatureStore.setState({ features: DEFAULT_FEATURES, storageError: saveFeatures(DEFAULT_FEATURES) });
  },

  openSettings(): void {
    useFeatureStore.setState({ settingsOpen: true });
  },

  closeSettings(): void {
    useFeatureStore.setState({ settingsOpen: false });
  },
};

/** React hook: is `id` effectively enabled (self and all ancestors on)? */
export function useFeature(id: FeatureId): boolean {
  return useFeatureStore((s) => featureEnabled(id, s.features));
}

/** Non-hook check for stores and imperative code. */
export function isFeatureEnabled(id: FeatureId): boolean {
  return featureEnabled(id, useFeatureStore.getState().features);
}
