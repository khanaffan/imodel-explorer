import "@itwin/itwinui-react/styles.css";
import "@bentley/icons-generic-webfont/dist/bentley-icons-generic-webfont.css";
import { StandardNavigationToolsProvider, UiFramework, UiItemsManager } from "@itwin/appui-react";
import { IModelApp } from "@itwin/core-frontend";
import { ElectronApp } from "@itwin/core-electron/renderer";
import { ITwinLocalization } from "@itwin/core-i18n";
import { Presentation } from "@itwin/presentation-frontend";
import { LOCALIZATION_NAMESPACES as TREE_WIDGET_NAMESPACES } from "@itwin/tree-widget-react";
import { createRoot } from "react-dom/client";
import { getRpcInterfaces } from "../common/appInfo";
import { App } from "./App";
import { instanceGraphUiProvider } from "./frontstages/InstanceGraphUiProvider";
import { MAIN_STAGE_ID } from "./frontstages/MainFrontstage";
import { openAndShow } from "./imodel/session";
import { graphActions, useGraphStore } from "./state/graphStore";
import { getUnifiedSelectionStorage } from "./state/selectionStorage";

async function start() {
  await ElectronApp.startup({
    iModelApp: {
      rpcInterfaces: getRpcInterfaces(),
      localization: new ITwinLocalization({ urlTemplate: "./locales/{{lng}}/{{ns}}.json", initOptions: { load: "languageOnly" } }),
    },
  });
  await Presentation.initialize({ selection: { selectionStorage: getUnifiedSelectionStorage() } });
  await Promise.all(TREE_WIDGET_NAMESPACES.map(async (ns) => IModelApp.localization.registerNamespace(ns)));
  await UiFramework.initialize();
  UiItemsManager.register(instanceGraphUiProvider);
  StandardNavigationToolsProvider.register("InstanceGraph:Navigation", undefined, (stageId) => stageId === MAIN_STAGE_ID);
  // Automation / console hook for developers and smoke tests.
  (globalThis as Record<string, unknown>).instanceGraph = { openAndShow, graphActions, getState: useGraphStore.getState, IModelApp };
  createRoot(document.getElementById("root")!).render(<App />);
}

start().catch((err) => {
  document.body.innerText = `Failed to start InstanceGraph:\n${err instanceof Error ? err.stack ?? err.message : String(err)}`;
});
