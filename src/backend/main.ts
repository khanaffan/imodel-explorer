import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { IModelHost } from "@itwin/core-backend";
import { ECSchemaRpcImpl } from "@itwin/ecschema-rpcinterface-impl";
import { Presentation } from "@itwin/presentation-backend";
import { ElectronHost } from "@itwin/core-electron/lib/cjs/ElectronBackend";
import { APP_TITLE, getRpcInterfaces } from "../common/appInfo";

/** Thin host shim. All graph work happens in the renderer against the `IModelConnection`; the
 * backend only needs to open files and serve tiles, so no custom IPC handlers are registered.
 * This is the only file that knows about Electron — a Studio host would replace it. */
async function main() {
  migrateLocalStorage();
  const dev = process.env.IG_DEV === "1";
  await ElectronHost.startup({
    electronHost: {
      webResourcesPath: path.join(__dirname, "..", "frontend"),
      developmentServer: dev,
      frontendPort: 3000,
      rpcInterfaces: getRpcInterfaces(),
    },
    iModelHost: {
      cacheDir: path.join(app.getPath("userData"), "cache"),
    },
  });
  ECSchemaRpcImpl.register();
  Presentation.initialize();
  await ElectronHost.openMainWindow({ title: APP_TITLE, width: 1600, height: 1000, show: true, storeWindowName: "instance-graph-main" });
  if (dev)
    ElectronHost.mainWindow?.webContents.openDevTools({ mode: "detach" });
  ElectronHost.app.on("window-all-closed", () => {
    void IModelHost.shutdown().finally(() => ElectronHost.app.quit());
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

/** The app was called InstanceGraph (user-data folder `instance-graph`). Carry its localStorage
 * (sessions, recent files, colours, options) over once, before Chromium opens the new profile. */
function migrateLocalStorage() {
  try {
    const target = path.join(app.getPath("userData"), "Local Storage");
    const source = path.join(app.getPath("appData"), "instance-graph", "Local Storage");
    if (!fs.existsSync(target) && fs.existsSync(source))
      fs.cpSync(source, target, { recursive: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Could not migrate settings from InstanceGraph:", e);
  }
}
