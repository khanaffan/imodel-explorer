import { Button, DropdownMenu, MenuItem, Text, Textarea } from "@itwin/itwinui-react";
import { useCallback, useState } from "react";
import { nodeKeyString } from "../engine/GraphModel";
import { EXAMPLE_SEED_QUERIES, runSeedQuery, SEED_LIMIT, type SeedQueryResult } from "../engine/seedQuery";
import { graphActions, useGraphStore } from "../state/graphStore";
import "./widgets.css";

const QUERY_KEY = "instanceGraph.seedQuery";

export function SeedQueryWidget() {
  const engine = useGraphStore((s) => s.engine);
  const centreKey = useGraphStore((s) => s.graph.centreKey);
  const [ecsql, setEcsql] = useState(() => localStorage.getItem(QUERY_KEY) ?? EXAMPLE_SEED_QUERIES[0].ecsql);
  const [result, setResult] = useState<SeedQueryResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState("");

  const run = useCallback(async () => {
    if (!engine || !ecsql.trim()) return;
    localStorage.setItem(QUERY_KEY, ecsql);
    setRunning(true);
    setError(undefined);
    try {
      const r = await runSeedQuery(engine, ecsql);
      setResult(r);
      if (r.candidates.length === 1)
        void graphActions.showInstance(r.candidates[0].key, { fit: true });
    } catch (e) {
      setResult(undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [engine, ecsql]);

  const visible = result?.candidates.filter((c) => !filter || `${c.label} ${c.className} ${c.key.id}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

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
            {result.candidates.length > 8 && (
              <input className="ig-filter-input" placeholder="Filter results" value={filter} onChange={(e) => setFilter(e.target.value)} />
            )}
          </div>
          <div className="ig-list">
            {visible.map((c) => {
              const k = nodeKeyString(c.key);
              return (
                <button key={k} className={`ig-list__item${k === centreKey ? " ig-list__item--active" : ""}`}
                  onClick={() => void graphActions.showInstance(c.key, { fit: true })} title={`${c.className} ${c.key.id}`}>
                  <span className="ig-list__primary">{c.label}</span>
                  <span className="ig-list__secondary">{c.className.split(":")[1]} · {c.key.id}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
