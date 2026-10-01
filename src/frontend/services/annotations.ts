import { create } from "zustand";

/** Notes users attach to instances, per iModel file, keyed by `classId:id`. Kept in localStorage
 * and, optionally, in saved sessions. */
export type Notes = Readonly<Record<string, string>>;

const STORAGE_KEY = "instanceGraph.annotations";
const NODE_KEY = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
export const NOTE_MAX_LENGTH = 2000;

/** Validates untrusted notes (storage or an imported session): keeps entries with a valid instance
 * key and non-empty text, trims, and caps the length. */
export function parseNotes(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (!NODE_KEY.test(k) || typeof v !== "string") continue;
    const text = v.trim().slice(0, NOTE_MAX_LENGTH);
    if (text) out[k.toLowerCase()] = text;
  }
  return out;
}

function load(storage: Pick<Storage, "getItem"> | undefined): Record<string, Notes> {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    const out: Record<string, Notes> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      for (const [file, notes] of Object.entries(raw)) {
        const parsed = parseNotes(notes);
        if (Object.keys(parsed).length > 0) out[file] = parsed;
      }
    return out;
  } catch {
    return {}; // corrupt storage: start without notes rather than fail the app
  }
}

interface AnnotationState {
  readonly byFile: Readonly<Record<string, Notes>>;
}

export const useAnnotationStore = create<AnnotationState>(() => ({
  byFile: load(typeof localStorage === "undefined" ? undefined : localStorage),
}));

const EMPTY: Notes = {};

function commit(file: string, notes: Notes) {
  const byFile = { ...useAnnotationStore.getState().byFile };
  if (Object.keys(notes).length > 0) byFile[file] = notes;
  else delete byFile[file];
  useAnnotationStore.setState({ byFile });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(byFile));
}

export function notesFor(file: string | undefined): Notes {
  return (file && useAnnotationStore.getState().byFile[file]) || EMPTY;
}

export function useNote(file: string | undefined, key: string): string | undefined {
  return useAnnotationStore((s) => (file ? s.byFile[file]?.[key.toLowerCase()] : undefined));
}

export function useNotes(file: string | undefined): Notes {
  return useAnnotationStore((s) => (file && s.byFile[file]) || EMPTY);
}

export const annotationActions = {
  /** Sets, or with empty text removes, the note on `key`. */
  setNote(file: string, key: string, text: string): void {
    if (!NODE_KEY.test(key)) throw new Error(`Not an instance key: ${key}`);
    const trimmed = text.trim();
    if (trimmed.length > NOTE_MAX_LENGTH) throw new Error(`Notes are limited to ${NOTE_MAX_LENGTH} characters.`);
    const notes: Record<string, string> = { ...notesFor(file) };
    if (trimmed) notes[key.toLowerCase()] = trimmed;
    else delete notes[key.toLowerCase()];
    commit(file, notes);
  },

  /** Adds notes from a session without overwriting ones already here. Returns how many were added. */
  mergeNotes(file: string, incoming: Notes): number {
    const notes: Record<string, string> = { ...notesFor(file) };
    let added = 0;
    for (const [k, v] of Object.entries(parseNotes(incoming)))
      if (!(k in notes)) { notes[k] = v; added++; }
    if (added > 0) commit(file, notes);
    return added;
  },
};
