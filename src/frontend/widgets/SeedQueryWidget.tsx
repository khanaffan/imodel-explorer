import { Button, DropdownMenu, MenuItem, Text, Textarea } from "@itwin/itwinui-react";
import { UiFramework } from "@itwin/appui-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { nodeKeyString } from "../engine/GraphModel";
import { EXAMPLE_SEED_QUERIES, RANK_LIMIT, rankSeedCandidates, runSeedQuery, SEED_LIMIT, type SeedQueryResult } from "../engine/seedQuery";
import { graphActions, useGraphStore } from "../state/graphStore";
import { useFeature } from "../state/featureStore";
import { useOverviewStore } from "../state/censusStore";
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

  const run = useCallback(async (sql?: string) => {
    const text = sql ?? ecsql;
    if (!engine || !text.trim()) return;
    localStorage.setItem(QUERY_KEY, text);
    setRunning(true);
    setError(undefined);
    setRanks(undefined);
    try {
      const r = await runSeedQuery(engine, text);
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

  let visible = result?.candidates.filter((c) => !filter || `${c.label} ${c.className} ${c.key.id}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  if (ranks)
    visible = [...visible].sort((a, b) => (ranks.get(nodeKeyString(b.key)) ?? -1) - (ranks.get(nodeKeyString(a.key)) ?? -1));

  return (
    <div className="ig-widget">
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
      </div>
      {error && <div className="ig-error">{error}</div>}
      {result && (
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
