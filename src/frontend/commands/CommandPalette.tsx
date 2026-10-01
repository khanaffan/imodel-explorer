import { ProgressRadial, Text } from "@itwin/itwinui-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type NodeKey, parseNodeKey } from "../engine/GraphModel";
import { searchInstances } from "../engine/instanceSearch";
import { listSessions, type SavedSession } from "../services/sessionStore";
import { listSeedsFor } from "../services/seedLibrary";
import { looksLikeDeepLink, parseDeepLink } from "../../common/deepLink";
import { useNotes } from "../services/annotations";
import { requestSeedQuery } from "../state/censusStore";
import { UiFramework } from "@itwin/appui-react";
import { SEED_WIDGET_ID } from "../widgets/SeedQueryWidget";
import { useClassGraphStore } from "../state/classGraphStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import { fuzzyScore } from "./fuzzy";
import { notify } from "./notify";
import { paletteActions, usePaletteStore } from "./paletteStore";
import { formatShortcut, runCommand, useCommandStore } from "./registry";
import "./palette.css";

interface PaletteItem {
  readonly key: string;
  readonly title: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly disabled?: string;
  readonly score: number;
  run(shift: boolean): void;
}

const MAX_ITEMS = 60;
const SEARCH_DELAY_MS = 200;

type InstanceResults = { readonly query: string; readonly items: ReadonlyArray<{ key: NodeKey; label: string; className: string }>; readonly error?: string };

function reportFailure(what: string) {
  return (e: unknown) => notify.error(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
}

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  return open ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const commands = useCommandStore((s) => s.commands);
  const engine = useGraphStore((s) => s.engine);
  const fileName = useGraphStore((s) => s.fileName);
  const [query, setQuery] = useState(() => usePaletteStore.getState().initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [instances, setInstances] = useState<InstanceResults>();
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sessions = useMemo<SavedSession[]>(() => (fileName ? listSessions().filter((s) => s.fileName === fileName) : []), [fileName]);
  const notes = useNotes(engine ? fileName : undefined);
  const seeds = useMemo(() => (engine ? listSeedsFor(fileName) : []), [engine, fileName]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const end = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(end, end);
    return () => previous?.focus?.();
  }, []);

  // Instance search: debounced, and a newer query always wins over a slower older one.
  useEffect(() => {
    const q = query.trim();
    if (!engine || q.length < 2) { setInstances(undefined); setSearching(false); return; }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchInstances(engine, q)
        .then((found) => { if (!stale) setInstances({ query: q, items: found.map((c) => ({ key: c.key, label: c.label, className: c.className })) }); })
        .catch((e: unknown) => { if (!stale) setInstances({ query: q, items: [], error: e instanceof Error ? e.message : String(e) }); })
        .finally(() => { if (!stale) setSearching(false); });
    }, SEARCH_DELAY_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [engine, query]);

  const items = useMemo(() => {
    const out: PaletteItem[] = [];
    const add = (item: Omit<PaletteItem, "score">, haystack: string, boost = 0) => {
      const score = fuzzyScore(query, haystack);
      if (score !== undefined) out.push({ ...item, score: score + boost });
    };
    for (const c of commands.values()) {
      if (c.inPalette === false) continue;
      const disabled = c.disabledReason?.();
      if (c.children) {
        if (disabled) continue;
        for (const child of c.children())
          add({ key: `${c.id}|${child.arg}`, title: `${c.title}: ${child.label}`, detail: c.group, run: () => void runCommand(c.id, "palette", child.arg) },
            `${c.title} ${child.label} ${c.keywords ?? ""}`);
      } else {
        add({ key: c.id, title: c.title, detail: c.group, hint: c.shortcut && formatShortcut(c.shortcut), disabled,
          run: () => void runCommand(c.id, "palette") }, `${c.title} ${c.group} ${c.keywords ?? ""}`, disabled ? -5 : 0);
      }
    }
    if (query.trim()) {
      for (const s of sessions)
        add({ key: `session|${s.name}`, title: `Open session: ${s.name}`, detail: `Saved ${new Date(s.savedAt).toLocaleString()}`,
          run: () => void graphActions.restoreSession(s).catch(reportFailure("Opening the session")) }, `session ${s.name}`);
    }
    if (query.trim()) {
      const centreOf = (key: string) => () => void graphActions.seedExternal(parseNodeKey(key), { fit: true }).catch(reportFailure("Centring"));
      for (const [key, text] of Object.entries(notes)) {
        const label = useGraphStore.getState().graph.nodes.get(key)?.label;
        add({ key: `note|${key}`, title: `Note: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`, detail: label ? `${label} · ${key}` : key,
          hint: "↵ centre", run: centreOf(key) }, `note ${text} ${label ?? ""}`);
      }
    }
    for (const seed of seeds)
      add({ key: `seed|${seed.fileName ?? ""}|${seed.name}`, title: `Run saved query: ${seed.name}`, detail: seed.description ?? "Seed query",
        run: () => {
          UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(SEED_WIDGET_ID)?.show();
          requestSeedQuery(seed.ecsql);
        } }, `saved query seed bookmark ${seed.name} ${seed.description ?? ""}`);
    if (looksLikeDeepLink(query)) {
      let problem: string | undefined;
      try { parseDeepLink(query); } catch (e) { problem = e instanceof Error ? e.message : String(e); }
      out.push({ key: "link", title: "Open this link", detail: "Link", disabled: problem, score: Number.MAX_SAFE_INTEGER,
        run: () => void runCommand("link.open", "palette", query.trim()) });
    }
    const inInstanceGraph = useClassGraphStore.getState().mode === "instances";
    const centre = useGraphStore.getState().graph.centreKey;
    for (const inst of instances?.query === query.trim() ? instances.items : []) {
      out.push({
        key: `instance|${inst.key.classId}:${inst.key.id}`, title: inst.label, detail: `${inst.className} · ${inst.key.id}`,
        hint: centre && inInstanceGraph ? "↵ centre · ⇧↵ path" : "↵ centre",
        // The database matched it as a substring, so it ranks with literal command matches.
        score: (fuzzyScore(query, `${inst.label} ${inst.className} ${inst.key.id}`) ?? 0) + 3,
        run: (shift) => {
          if (shift && centre && inInstanceGraph) void graphActions.findPath(inst.key).catch(reportFailure("Find path"));
          else void graphActions.seedExternal(inst.key, { fit: true }).catch(reportFailure("Centring"));
        },
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS);
  }, [commands, query, sessions, seeds, notes, instances]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: PaletteItem | undefined, shift: boolean) => {
    if (!item) return;
    paletteActions.close();
    item.run(shift);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active], e.shiftKey); }
    else if (e.key === "Escape") { e.preventDefault(); paletteActions.close(); }
  };

  const instanceStatus = !engine ? undefined
    : query.trim().length < 2 ? "Type 2+ characters to search instances by label, code or id."
      : instances?.error ? `Instance search failed: ${instances.error}` : undefined;

  return (
    <div className="ig-palette__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) paletteActions.close(); }}>
      <div className="ig-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="ig-palette__field">
          <input ref={input} className="ig-palette__input" placeholder="Type a command, instance label, code or id…" value={query}
            onChange={(e) => setQuery(e.target.value)} role="combobox" aria-expanded="true" aria-controls="ig-palette-list"
            aria-activedescendant={items[active] ? `ig-palette-${active}` : undefined} aria-autocomplete="list" />
          {searching && <ProgressRadial size="x-small" indeterminate />}
        </div>
        <div ref={list} id="ig-palette-list" className="ig-palette__list" role="listbox">
          {items.map((item, i) => (
            <div key={item.key} id={`ig-palette-${i}`} data-index={i} role="option" aria-selected={i === active} aria-disabled={!!item.disabled}
              className={`ig-palette__item${i === active ? " ig-palette__item--active" : ""}${item.disabled ? " ig-palette__item--disabled" : ""}`}
              onMouseMove={() => setActive(i)} onClick={(e) => choose(item, e.shiftKey)} title={item.disabled}>
              <span className="ig-palette__title">{item.title}</span>
              <span className="ig-palette__detail">{item.disabled ?? item.detail}</span>
              {item.hint && <kbd className="ig-palette__hint">{item.hint}</kbd>}
            </div>
          ))}
          {items.length === 0 && !searching && <div className="ig-palette__empty">No matches.</div>}
        </div>
        {instanceStatus && <Text variant="small" isMuted className="ig-palette__footer">{instanceStatus}</Text>}
      </div>
    </div>
  );
}
