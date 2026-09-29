import { IModelApp, type ScreenViewport, ViewCreator3d, type ViewState } from "@itwin/core-frontend";
import { StandardViewId } from "@itwin/core-frontend";
import { ViewportComponent } from "@itwin/imodel-components-react";
import { Text } from "@itwin/itwinui-react";
import type { Range3d } from "@itwin/core-geometry";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGraphStore } from "../state/graphStore";
import { queryRobustExtents, shouldRefit } from "./robustExtents";
import { viewportSync } from "./viewportSync";

export function ViewportContent() {
  const connection = useGraphStore((s) => s.connection);
  const [viewState, setViewState] = useState<ViewState>();
  const [error, setError] = useState<string>();
  const fitRange = useRef<Range3d>();

  useEffect(() => {
    setViewState(undefined);
    setError(undefined);
    fitRange.current = undefined;
    if (!connection) return;
    let live = true;
    const create = async () => {
      const vs = await new ViewCreator3d(connection).createDefaultView({ skyboxOn: false, standardViewId: StandardViewId.Iso });
      // A few stray elements can inflate the project extents enough that the default fit shows nothing.
      const robust = await queryRobustExtents(connection).catch(() => undefined);
      if (vs.is3d() && shouldRefit(vs.getExtents().magnitude(), robust)) {
        robust.scaleAboutCenterInPlace(1.1);
        vs.lookAtVolume(robust);
        fitRange.current = robust;
      }
      return vs;
    };
    create()
      .then((vs) => live && setViewState(vs))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [connection]);

  useEffect(() => () => viewportSync.detach(), []);

  const onViewport = useCallback((vp: ScreenViewport) => {
    viewportSync.attach(vp);
    // Refit with the viewport's real aspect ratio.
    if (fitRange.current) vp.zoomToVolume(fitRange.current);
    void IModelApp.toolAdmin.startDefaultTool();
  }, []);

  if (error) return <div className="ig-viewport-msg"><Text isMuted>No 3D view: {error}</Text></div>;
  if (!connection || !viewState) return <div className="ig-viewport-msg"><Text isMuted>Preparing 3D view…</Text></div>;
  return <ViewportComponent imodel={connection} viewState={viewState} viewportRef={onViewport} />;
}
