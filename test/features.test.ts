import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FEATURES, featureActions, featureEnabled, FEATURES, loadFeatures, saveFeatures,
  STORAGE_KEY, useFeatureStore,
} from "../src/frontend/state/featureStore";

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    dump: () => map.get(STORAGE_KEY),
  };
}

describe("feature definitions", () => {
  it("defaults everything on except the opt-in geometry extras", () => {
    for (const f of FEATURES) {
      const expected = f.id !== "geometry.brep" && f.id !== "geometry.overlay";
      expect(f.defaultEnabled, f.id).toBe(expected);
    }
  });

  it("children always follow their parent in the tree order and parents exist", () => {
    const seen = new Set<string>();
    for (const f of FEATURES) {
      if (f.parent) expect(seen.has(f.parent), `${f.id} after ${f.parent}`).toBe(true);
      seen.add(f.id);
    }
  });
});

describe("featureEnabled", () => {
  it("is on when the feature and its ancestors are on", () => {
    expect(featureEnabled("overview.models", DEFAULT_FEATURES)).toBe(true);
  });

  it("a disabled parent turns children off but preserves their stored choice", () => {
    const map = { ...DEFAULT_FEATURES, overview: false };
    expect(featureEnabled("overview", map)).toBe(false);
    expect(featureEnabled("overview.models", map)).toBe(false);
    expect(map["overview.models"]).toBe(true); // choice preserved
    expect(featureEnabled("overview.models", { ...map, overview: true })).toBe(true);
  });

  it("a disabled child does not affect its parent or siblings", () => {
    const map = { ...DEFAULT_FEATURES, "overview.models": false };
    expect(featureEnabled("overview", map)).toBe(true);
    expect(featureEnabled("overview.relationships", map)).toBe(true);
    expect(featureEnabled("overview.models", map)).toBe(false);
  });
});

describe("loadFeatures", () => {
  it("returns defaults when nothing is stored or storage is unavailable", () => {
    expect(loadFeatures(memoryStorage())).toEqual(DEFAULT_FEATURES);
    expect(loadFeatures(undefined)).toEqual(DEFAULT_FEATURES);
  });

  it("round-trips through saveFeatures", () => {
    const storage = memoryStorage();
    const map = { ...DEFAULT_FEATURES, schema: false, "geometry.brep": true };
    expect(saveFeatures(map, storage)).toBeUndefined();
    expect(loadFeatures(storage)).toEqual(map);
  });

  it("ignores malformed JSON, non-object payloads and non-boolean values", () => {
    expect(loadFeatures(memoryStorage({ [STORAGE_KEY]: "{oops" }))).toEqual(DEFAULT_FEATURES);
    expect(loadFeatures(memoryStorage({ [STORAGE_KEY]: "42" }))).toEqual(DEFAULT_FEATURES);
    const mixed = JSON.stringify({ schema: "nope", sessions: false, unknownFeature: true });
    expect(loadFeatures(memoryStorage({ [STORAGE_KEY]: mixed }))).toEqual({ ...DEFAULT_FEATURES, sessions: false });
  });

  it("drops stored ids that no longer exist", () => {
    const stored = JSON.stringify({ retiredFeature: false, overview: false });
    const loaded = loadFeatures(memoryStorage({ [STORAGE_KEY]: stored }));
    expect(loaded).toEqual({ ...DEFAULT_FEATURES, overview: false });
    expect("retiredFeature" in loaded).toBe(false);
  });
});

describe("saveFeatures", () => {
  it("reports the failure message instead of throwing", () => {
    const err = saveFeatures(DEFAULT_FEATURES, { setItem: () => { throw new Error("quota exceeded"); } });
    expect(err).toBe("quota exceeded");
  });
});

describe("featureActions", () => {
  beforeEach(() => {
    useFeatureStore.setState({ features: DEFAULT_FEATURES, storageError: undefined, settingsOpen: false });
  });

  it("setEnabled updates state and persists", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    try {
      featureActions.setEnabled("sessions", false);
      const s = useFeatureStore.getState();
      expect(s.features.sessions).toBe(false);
      expect(s.storageError).toBeUndefined();
      expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(s.features));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces persistence failures but keeps the in-memory change", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("disk full"); } });
    try {
      featureActions.setEnabled("legend", false);
      const s = useFeatureStore.getState();
      expect(s.features.legend).toBe(false);
      expect(s.storageError).toBe("disk full");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resetDefaults restores every choice", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { } });
    try {
      featureActions.setEnabled("overview", false);
      featureActions.setEnabled("geometry.brep", true);
      featureActions.resetDefaults();
      expect(useFeatureStore.getState().features).toEqual(DEFAULT_FEATURES);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
