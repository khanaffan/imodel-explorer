import { create } from "zustand";
import { type Census, loadCensus, type ModelCensusEntry, loadModelCensus, loadModelTotals } from "../engine/census";
import { loadRelationshipCensus, type RelationshipCensusEntry } from "../engine/classGraph";
import type { GraphEngine } from "../engine/GraphEngine";

/** Census results live as long as the engine (one per connection); a WeakMap keeps the lifecycle
 * automatic without wiring into attach/detach. */
const censusCache = new WeakMap<GraphEngine, Promise<Census>>();
const totalsCache = new WeakMap<GraphEngine, Promise<Map<string, number>>>();
const perModelCache = new WeakMap<GraphEngine, Map<string, Promise<ModelCensusEntry[]>>>();
const relCensusCache = new WeakMap<GraphEngine, Promise<RelationshipCensusEntry[]>>();

export function relCensusFor(engine: GraphEngine): Promise<RelationshipCensusEntry[]> {
  let p = relCensusCache.get(engine);
  if (!p) {
    p = loadRelationshipCensus(engine.port, engine.registry);
    relCensusCache.set(engine, p);
  }
  return p;
}

export function censusFor(engine: GraphEngine): Promise<Census> {
  let p = censusCache.get(engine);
  if (!p) {
    p = loadCensus(engine.port, engine.registry);
    censusCache.set(engine, p);
  }
  return p;
}

export function modelTotalsFor(engine: GraphEngine): Promise<Map<string, number>> {
  let p = totalsCache.get(engine);
  if (!p) {
    p = loadModelTotals(engine.port);
    totalsCache.set(engine, p);
  }
  return p;
}

export function modelCensusFor(engine: GraphEngine, modelId: string): Promise<ModelCensusEntry[]> {
  let byModel = perModelCache.get(engine);
  if (!byModel) {
    byModel = new Map();
    perModelCache.set(engine, byModel);
  }
  let p = byModel.get(modelId);
  if (!p) {
    p = loadModelCensus(engine.port, engine.registry, modelId);
    byModel.set(modelId, p);
  }
  return p;
}

export interface SeedRequest {
  readonly ecsql: string;
  readonly nonce: number;
}

interface OverviewState {
  /** Set to ask the Seed query widget to load and run this ECSQL. */
  readonly seedRequest?: SeedRequest;
}

export const useOverviewStore = create<OverviewState>(() => ({}));

let nonce = 0;

/** Fills the Seed query widget with `ecsql`, runs it and brings the widget to front. */
export function requestSeedQuery(ecsql: string): void {
  useOverviewStore.setState({ seedRequest: { ecsql, nonce: ++nonce } });
}
