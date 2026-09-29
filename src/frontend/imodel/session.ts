import { UiFramework } from "@itwin/appui-react";
import { createMainFrontstage, MAIN_STAGE_ID } from "../frontstages/MainFrontstage";
import { appHost } from "../host/AppHost";
import { graphActions, useGraphStore } from "../state/graphStore";
import { closeIModel, openIModelFile } from "./openIModel";

let stageRegistered = false;

/** Opens a file, activates the main frontstage and wires the graph engine to it. */
export async function openAndShow(fileName: string): Promise<void> {
  await closeCurrent();
  const connection = await openIModelFile(fileName);
  appHost.addRecentFile(fileName);
  UiFramework.setIModelConnection(connection, true);
  if (!stageRegistered) {
    UiFramework.frontstages.addFrontstage(createMainFrontstage(() => void closeCurrent()));
    stageRegistered = true;
  }
  await UiFramework.frontstages.setActiveFrontstage(MAIN_STAGE_ID);
  document.title = `InstanceGraph — ${fileName.split(/[\\/]/).pop()}`;
  await graphActions.attach(connection, fileName);
}

export async function closeCurrent(): Promise<void> {
  const { connection } = useGraphStore.getState();
  if (!connection) return;
  graphActions.detach();
  UiFramework.setIModelConnection(undefined, true);
  document.title = "InstanceGraph";
  await closeIModel(connection);
}
