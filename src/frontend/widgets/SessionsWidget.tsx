import { Button, Input, Text } from "@itwin/itwinui-react";
import { useRef, useState } from "react";
import { downloadText, safeFileStem } from "../services/exporters";
import { captureSession, deleteSession, listSessions, parseSession, type SavedSession, storeSession } from "../services/sessionStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import "./widgets.css";

export function SessionsWidget() {
  const fileName = useGraphStore((s) => s.fileName);
  const hasGraph = useGraphStore((s) => s.graph.nodes.size > 0);
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState(() => listSessions());
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const capture = (n: string) => {
    const { graph, options, layoutMode } = useGraphStore.getState();
    return fileName ? captureSession(n, fileName, graph, options, layoutMode) : undefined;
  };

  const save = () => {
    const s = capture(name.trim() || `Session ${new Date().toLocaleString()}`);
    if (!s) return;
    storeSession(s);
    setSessions(listSessions());
    setName("");
  };

  const open = async (s: SavedSession) => {
    setError(undefined);
    if (s.fileName && fileName && s.fileName !== fileName)
      setError(`Captured on ${s.fileName}; applying to the open iModel anyway.`);
    try {
      await graphActions.restoreSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (file: File) => {
    try {
      const s = parseSession(JSON.parse(await file.text()));
      storeSession(s);
      setSessions(listSessions());
      await open(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forThisFile = sessions.filter((s) => s.fileName === fileName);
  const others = sessions.filter((s) => s.fileName !== fileName);

  return (
    <div className="ig-widget">
      <Text variant="small" isMuted>A session stores the centre, depth, filters and manual expansions, and replays them.</Text>
      <div className="ig-row">
        <Input size="small" placeholder="Session name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button size="small" disabled={!hasGraph} onClick={save}>Save</Button>
      </div>
      <div className="ig-row">
        <Button size="small" styleType="borderless" disabled={!hasGraph} onClick={() => {
          const s = capture(name.trim() || "session");
          if (s) downloadText(`${safeFileStem(fileName)}-${safeFileStem(s.name)}.igsession.json`, JSON.stringify(s, null, 2), "application/json");
        }}>Export file…</Button>
        <Button size="small" styleType="borderless" onClick={() => fileInput.current?.click()}>Import file…</Button>
        <input ref={fileInput} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
      </div>
      {error && <div className="ig-error">{error}</div>}
      {forThisFile.length === 0 && <Text variant="small" isMuted>No saved sessions for this iModel.</Text>}
      <div className="ig-list">
        {[...forThisFile, ...others].map((s) => (
          <div key={`${s.fileName}|${s.name}`} className="ig-filter-row">
            <button className="ig-list__item" onClick={() => void open(s)} title={`${s.fileName}\n${s.savedAt}`}>
              <span className="ig-list__primary">{s.name}</span>
              <span className="ig-list__secondary">
                {s.fileName !== fileName ? `${safeFileStem(s.fileName)} · ` : ""}depth {s.depth} · {new Date(s.savedAt).toLocaleString()}
              </span>
            </button>
            <button className="ig-x" title="Delete" onClick={() => { deleteSession(s); setSessions(listSessions()); }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
