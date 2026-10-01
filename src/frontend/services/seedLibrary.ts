/** Saved seed queries ("bookmarks") and the recent-query history, kept in localStorage. */

export interface SavedSeed {
  readonly name: string;
  readonly ecsql: string;
  readonly description?: string;
  /** iModel path the seed belongs to; unset means it is offered for every iModel. */
  readonly fileName?: string;
  readonly savedAt: string;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const SAVED_KEY = "instanceGraph.savedSeeds";
const HISTORY_KEY = "instanceGraph.seedHistory";
export const SEED_HISTORY_LIMIT = 20;

const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

export function onSeedsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Validates an untrusted stored entry; throws with the reason when it is not a seed. */
export function parseSavedSeed(value: unknown): SavedSeed {
  const v = value as Partial<SavedSeed> | null;
  if (!v || typeof v !== "object") throw new Error("Not a saved seed");
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const ecsql = typeof v.ecsql === "string" ? v.ecsql.trim() : "";
  if (!name) throw new Error("Saved seed has no name");
  if (!ecsql) throw new Error("Saved seed has no query");
  return {
    name, ecsql,
    ...(typeof v.description === "string" && v.description.trim() ? { description: v.description.trim() } : {}),
    ...(typeof v.fileName === "string" && v.fileName ? { fileName: v.fileName } : {}),
    savedAt: typeof v.savedAt === "string" ? v.savedAt : new Date(0).toISOString(),
  };
}

function readArray(storage: Pick<Storage, "getItem">, key: string): unknown[] {
  try {
    const raw = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // corrupt storage: start over rather than block the panel
  }
}

const sameSlot = (a: SavedSeed, b: Pick<SavedSeed, "name" | "fileName">) => a.name === b.name && a.fileName === b.fileName;

/** Every saved seed, newest first. Corrupt entries are skipped. */
export function listAllSeeds(storage: Pick<Storage, "getItem"> = localStorage): SavedSeed[] {
  const out: SavedSeed[] = [];
  for (const r of readArray(storage, SAVED_KEY)) {
    try { out.push(parseSavedSeed(r)); } catch { /* skip corrupt entries */ }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Seeds offered for `fileName`: those scoped to it, then global ones. */
export function listSeedsFor(fileName: string | undefined, storage: Pick<Storage, "getItem"> = localStorage): SavedSeed[] {
  const all = listAllSeeds(storage);
  return [...all.filter((s) => s.fileName && s.fileName === fileName), ...all.filter((s) => !s.fileName)];
}

/** Saves `seed`, replacing one with the same name in the same scope. */
export function storeSeed(seed: SavedSeed, storage: Store = localStorage): SavedSeed {
  const valid = parseSavedSeed(seed);
  const others = listAllSeeds(storage).filter((s) => !sameSlot(s, valid));
  storage.setItem(SAVED_KEY, JSON.stringify([valid, ...others]));
  changed();
  return valid;
}

export function deleteSeed(seed: Pick<SavedSeed, "name" | "fileName">, storage: Store = localStorage): void {
  storage.setItem(SAVED_KEY, JSON.stringify(listAllSeeds(storage).filter((s) => !sameSlot(s, seed))));
  changed();
}

/** Recent queries, newest first, without duplicates. */
export function listSeedHistory(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  return readArray(storage, HISTORY_KEY).filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, SEED_HISTORY_LIMIT);
}

export function recordSeedQuery(ecsql: string, storage: Store = localStorage): void {
  const q = ecsql.trim();
  if (!q) return;
  const next = [q, ...listSeedHistory(storage).filter((h) => h !== q)].slice(0, SEED_HISTORY_LIMIT);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  changed();
}
