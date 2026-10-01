// Runs in the sandboxed renderer before ElectronHost's own preload. Sandboxed preloads can only
// require "electron", so this file must stay free of imports and exports. The bridge name and shape
// are mirrored by `HostBridge` in src/frontend/host/AppHost.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- an import would emit `exports`, which sandboxed preloads lack
const { contextBridge, webUtils } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("imodelExplorerHost", {
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
});
