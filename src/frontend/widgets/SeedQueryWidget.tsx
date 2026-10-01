import { Button, Checkbox, DropdownMenu, Input, MenuDivider, MenuItem, Text, Textarea } from "@itwin/itwinui-react";
import { UiFramework } from "@itwin/appui-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { nodeKeyString } from "../engine/GraphModel";
import { EXAMPLE_SEED_QUERIES, RANK_LIMIT, rankSeedCandidates, runSeedQuery, SEED_LIMIT, type SeedQueryResult } from "../engine/seedQuery";
import { graphActions, useGraphStore } from "../state/graphStore";
import { useFeature } from "../state/featureStore";
import { useOverviewStore } from "../state/censusStore";
import { notify } from "../commands/notify";
import { deleteSeed, listSeedHistory, listSeedsFor, onSeedsChanged, recordSeedQuery, type SavedSeed, storeSeed } from "../services/seedLibrary";
import { Skeleton } from "./Skeleton";
import "./widgets.css";

const QUERY_KEY = "instanceGraph.seedQuery";
export const SEED_WIDGET_ID = "ig-seed";

export function SeedQueryWidget() {
  const engine = useGraphStore((s) => s.engine);
  const centreKey = useGraphStore((s) => s.graph.centreKey);
  const [ecsql, setEcsql] = useState(() => localStorage.getItem(QUERY_KEY) ?? EXAMPLE_SEED_QUERIES[0].ecsql);
  const [result, setResult] = useState<SeedQueryResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("");
  const [ranks, setRanks] = useState<Map<string, number>>();
  const [ranking, setRanking] = useState(false);
  const rankingOn = useFeature("ranking");
  const fileName = useGraphStore((s) => s.fileName);
  const [library, setLibrary] = useState(() => ({ saved: listSeedsFor(fileName), history: listSeedHistory() }));
  useEffect(() => {
    const reload = () => setLibrary({ saved: listSeedsFor(fileName), history: listSeedHistory() });
    reload();
    return onSeedsChanged(reload);
  }, [fileName]);
  const [saving, setSaving] = useState<{ name: string; description: string; thisFileOnly: boolean }>();

  const run = useCallback(async (sql?: string) => {
    const text = sql ?? ecsql;
    if (!engine || !text.trim()) return;
    localStorage.setItem(QUERY_KEY, text);
    setRunning(true);
    setError(undefined);
    setRanks(undefined);
    try {
      const r = await runSeedQuery(engine, text);
      recordSeedQuery(text);
      setResult(r);
      if (r.candidates.length === 1)
        void graphActions.seedExternal(r.candidates[0].key, { fit: true });
    } catch (e) {
      setResult(undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [engine, ecsql]);

  // Other widgets (Overview) can ask for a query to be loaded and run here.
  const seedRequest = useOverviewStore((s) => s.seedRequest);
  const served = useRef(0);
  useEffect(() => {
    if (!seedRequest || seedRequest.nonce === served.current) return;
    served.current = seedRequest.nonce;
    setEcsql(seedRequest.ecsql);
    UiFramework.frontstages.activeFrontstageDef?.findWidgetDef(SEED_WIDGET_ID)?.show();
    void run(seedRequest.ecsql);
  }, [seedRequest, run]);

  const rank = useCallback(async () => {
    if (!engine || !result || result.candidates.length < 2) return;
    setRanking(true);
    try {
      setRanks(await rankSeedCandidates(engine, result.candidates.map((c) => c.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRanking(false);
    }
  }, [engine, result]);

  const saveSeed = () => {
    if (!saving) return;
    try {
      const seed = storeSeed({
        name: saving.name, ecsql, description: saving.description, savedAt: new Date().toISOString(),
        ...(saving.thisFileOnly && fileName ? { fileName } : {}),
      });
      setSaving(undefined);
      notify.success(`Saved query "${seed.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const savedItems = (close: () => void) => library.saved.length === 0
    ? [<MenuItem key="none" disabled>No saved queries yet</MenuItem>]
    : library.saved.map((seed: SavedSeed) => (
      <MenuItem key={`${seed.fileName ?? ""}|${seed.name}`} sublabel={seed.description ?? (seed.fileName ? "This iModel" : "All iModels")}
        subMenuItems={[
          <MenuItem key="run" onClick={() => { close(); setEcsql(seed.ecsql); void run(seed.ecsql); }}>Run</MenuItem>,
          <MenuItem key="load" onClick={() => { close(); setEcsql(seed.ecsql); }}>Load into editor</MenuItem>,
          <MenuDivider key="d" />,
          <MenuItem key="delete" onClick={() => { close(); deleteSeed(seed); }}>Delete</MenuItem>,
        ]}
        onClick={() => { close(); setEcsql(seed.ecsql); void run(seed.ecsql); }}>{seed.name}</MenuItem>
    ));

  let visible = result?.candidates.filter((c) => !filter || `${c.label} ${c.className} ${c.key.id}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  if (ranks)
    visible = [...visible].sort((a, b) => (ranks.get(nodeKeyString(b.key)) ?? -1) - (ranks.get(nodeKeyString(a.key)) ?? -1));

  return (
    <div className="ig-widget" data-tour="seed">
      <Text variant="small" isMuted>Any ECSQL returning an <code>ECInstanceId</code> (and ideally <code>ECClassId</code>). Pick a row to centre the graph on it.</Text>
      <Textarea
        className="ig-sql"
        rows={5}
        value={ecsql}
        spellCheck={false}
        onChange={(e) => setEcsql(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void run(); } }}
      />
      <div className="ig-row">
        <Button size="small" styleType="high-visibility" disabled={!engine || running} onClick={() => void run()}>{running ? "Running…" : "Run (⌘↵)"}</Button>
        <DropdownMenu menuItems={(close) => EXAMPLE_SEED_QUERIES.map((q) => (
          <MenuItem key={q.label} onClick={() => { close(); setEcsql(q.ecsql); }}>{q.label}</MenuItem>
        ))}>
          <Button size="small" styleType="borderless">Examples</Button>
        </DropdownMenu>
        <DropdownMenu menuItems={savedItems}>
          <Button size="small" styleType="borderless" data-testid="seed-saved">Saved ({library.saved.length})</Button>
        </DropdownMenu>
        <DropdownMenu menuItems={(close) => library.history.length === 0
          ? [<MenuItem key="none" disabled>No queries run yet</MenuItem>]
          : library.history.map((q, i) => (
            <MenuItem key={i} title={q} onClick={() => { close(); setEcsql(q); }}><span className="ig-seed-history">{q.replace(/\s+/g, " ")}</span></MenuItem>
          ))}>
          <Button size="small" styleType="borderless">History</Button>
        </DropdownMenu>
        <Button size="small" styleType="borderless" disabled={!ecsql.trim()} aria-expanded={!!saving}
          onClick={() => setSaving(saving ? undefined : { name: "", description: "", thisFileOnly: false })}>Save…</Button>
      </div>
      {saving && (
        <div className="ig-seed-save" role="group" aria-label="Save query">
          <Input size="small" placeholder="Name" value={saving.name} autoFocus
            onChange={(e) => setSaving({ ...saving, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveSeed(); else if (e.key === "Escape") setSaving(undefined); }} />
          <Input size="small" placeholder="Description (optional)" value={saving.description}
            onChange={(e) => setSaving({ ...saving, description: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveSeed(); else if (e.key === "Escape") setSaving(undefined); }} />
          <div className="ig-row">
            <Checkbox label="Only for this iModel" disabled={!fileName} checked={saving.thisFileOnly}
              onChange={(e) => setSaving({ ...saving, thisFileOnly: e.target.checked })} />
            <Button size="small" styleType="high-visibility" disabled={!saving.name.trim()} onClick={saveSeed}>Save query</Button>
          </div>
        </div>
      )}
      {error && <div className="ig-error">{error}</div>}
      {running && <Skeleton label="Running query" rows={5} twoLine />}
      {result && !running && (
        <>
          <div className="ig-row ig-row--between">
            <Text variant="small">
              {result.candidates.length}{result.truncated ? `+ (first ${SEED_LIMIT})` : ""} instance{result.candidates.length === 1 ? "" : "s"}
              {result.skipped > 0 && ` · ${result.skipped} rows without an id`}
            </Text>
            {rankingOn && result.candidates.length > 1 && !ranks && (
              <Button size="small" styleType="borderless" disabled={ranking} onClick={() => void rank()}
                title={`Sort by relationship fan-out (first ${RANK_LIMIT} rows) — the best-connected exemplars first`}>
                {ranking ? "Ranking…" : "Rank by connections"}
              </Button>
            )}
            {result.candidates.length > 8 && (
              <input className="ig-filter-input" placeholder="Filter results" value={filter} onChange={(e) => setFilter(e.target.value)} />
            )}
          </div>
          <div className="ig-list">
            {visible.map((c) => {
              const k = nodeKeyString(c.key);
              const rank = ranks?.get(k);
              return (
                <button key={k} className={`ig-list__item${k === centreKey ? " ig-list__item--active" : ""}`}
                  onClick={() => void graphActions.seedExternal(c.key, { fit: true })} title={`${c.className} ${c.key.id}`}>
                  <span className="ig-list__primary">{c.label}</span>
                  <span className="ig-list__secondary">
                    {c.className.split(":")[1]} · {c.key.id}
                    {rank !== undefined && <span className="ig-chip ig-chip--kind"> {rank} rel</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
