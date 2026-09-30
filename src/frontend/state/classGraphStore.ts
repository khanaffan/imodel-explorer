import { create } from "zustand";
import { buildClassGraph, type BuildProgress, type ClassGraphData } from "../engine/classGraph";
import type { GraphEngine } from "../engine/GraphEngine";
import { TraversalCancelled } from "../engine/GraphEngine";
import { censusFor } from "./censusStore";
import { useGraphStore } from "./graphStore";

export type GraphMode = "instances" | "classes";
export type ClassGraphScope = "neighbourhood" | "imodel";

export type ClassSelection =
  | { readonly kind: "class"; readonly key: string }
  | { readonly kind: "edge"; readonly key: string }
  | undefined;

export interface ClassGraphState {
  readonly mode: GraphMode;
  readonly scope: ClassGraphScope;
  /** Whole-iModel result (possibly still streaming in); the neighbourhood scope is derived
   * directly from the instance graph by the canvas. */
  readonly imodelGraph?: ClassGraphData;
  readonly building: boolean;
  readonly progress?: BuildProgress;
  readonly error?: string;
  readonly selection: ClassSelection;
}

export const useClassGraphStore = create<ClassGraphState>(() => ({
  mode: "instances",
  scope: "neighbourhood",
  building: false,
  selection: undefined,
}));

const set = useClassGraphStore.setState;
const get = useClassGraphStore.getState;

/** Whole-iModel class graphs per engine; dropped with the engine when the connection closes. */
const cache = new WeakMap<GraphEngine, ClassGraphData>();

let activeBuild: { cancelled: boolean } | undefined;
let generation = 0;

async function buildIModelGraph(engine: GraphEngine): Promise<void> {
  const cached = cache.get(engine);
  if (cached) {
    set({ imodelGraph: cached, building: false, progress: undefined, error: undefined });
    return;
  }
  if (activeBuild) activeBuild.cancelled = true;
  const token = { cancelled: false };
  activeBuild = token;
  const myGeneration = ++generation;
  set({ building: true, progress: undefined, error: undefined, imodelGraph: undefined });
  try {
    const census = await censusFor(engine).catch(() => undefined);
    const result = await buildClassGraph(engine.port, engine.registry, {
      census,
      cancel: token,
      onProgress: (partial, progress) => {
        if (myGeneration === generation) set({ imodelGraph: partial, progress });
      },
    });
    if (myGeneration !== generation) return;
    cache.set(engine, result);
    set({ imodelGraph: result, building: false, progress: undefined });
  } catch (e) {
    if (myGeneration !== generation) return;
    if (e instanceof TraversalCancelled) set({ building: false, progress: undefined });
    else set({ building: false, progress: undefined, error: e instanceof Error ? e.message : String(e) });
  }
}

export const classGraphActions = {
  setMode(mode: GraphMode): void {
    if (mode === get().mode) return;
    set({ mode, selection: undefined });
    if (mode === "classes" && get().scope === "imodel") void classGraphActions.ensureIModelGraph();
  },

  setScope(scope: ClassGraphScope): void {
    if (scope === get().scope) return;
    set({ scope, selection: undefined });
    if (scope === "imodel") void classGraphActions.ensureIModelGraph();
  },

  async ensureIModelGraph(): Promise<void> {
    const engine = useGraphStore.getState().engine;
    if (!engine || get().building) return;
    await buildIModelGraph(engine);
  },

  cancelBuild(): void {
    if (activeBuild) activeBuild.cancelled = true;
    generation++;
    set({ building: false, progress: undefined });
  },

  select(selection: ClassSelection): void {
    set({ selection });
  },

  /** Called when the connection changes: stale results must not show for the next iModel. */
  reset(): void {
    if (activeBuild) activeBuild.cancelled = true;
    generation++;
    set({ imodelGraph: undefined, building: false, progress: undefined, error: undefined, selection: undefined });
  },
};

// A new engine (or detach) invalidates the whole-iModel graph on display.
useGraphStore.subscribe((s, prev) => {
  if (s.engine !== prev.engine) classGraphActions.reset();
});
