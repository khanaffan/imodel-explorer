import { APP_TITLE } from "../common/appInfo";
import { SvgFolderOpened, SvgNetwork } from "@itwin/itwinui-icons-react";
import { Button, Text } from "@itwin/itwinui-react";
import { useState } from "react";
import { appHost } from "./host/AppHost";
import { openAndShow } from "./imodel/session";

export function WelcomePage() {
  const [recent, setRecent] = useState(() => appHost.getRecentFiles());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const open = async (path: string | undefined) => {
    if (!path) return;
    setBusy(path);
    setError(undefined);
    try {
      await openAndShow(path);
    } catch (e) {
      setError(`${path}\n${e instanceof Error ? e.message : String(e)}`);
      setRecent(appHost.getRecentFiles());
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="ig-welcome">
      <div className="ig-welcome__panel">
        <div className="ig-welcome__title"><SvgNetwork /> <span>{APP_TITLE}</span></div>
        <Text isMuted>Explore how EC instances in an iModel relate to each other — navigation properties, link-table relationships, models and aspects — starting from any instance you pick with ECSQL.</Text>
        <Button styleType="high-visibility" startIcon={<SvgFolderOpened />} disabled={!!busy}
          onClick={async () => open(await appHost.pickIModelFile())}>Open iModel…</Button>
        {busy && <Text variant="small" isMuted>Opening {busy}…</Text>}
        {error && <div className="ig-error">{error}</div>}
        {recent.length > 0 && (
          <div className="ig-welcome__recent">
            <Text variant="leading">Recent</Text>
            {recent.map((p) => (
              <div key={p} className="ig-filter-row">
                <button className="ig-list__item" disabled={!!busy} onClick={() => void open(p)} title={p}>
                  <span className="ig-list__primary">{p.split(/[\\/]/).pop()}</span>
                  <span className="ig-list__secondary">{p}</span>
                </button>
                <button className="ig-x" title="Remove from list" onClick={() => { appHost.removeRecentFile(p); setRecent(appHost.getRecentFiles()); }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
