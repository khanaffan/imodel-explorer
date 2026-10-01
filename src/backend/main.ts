import * as fs from "node:fs";
import * as path from "node:path";
import { app, Menu, type MenuItemConstructorOptions, session } from "electron";
import { IModelHost, IpcHost } from "@itwin/core-backend";
import { ECSchemaRpcImpl } from "@itwin/ecschema-rpcinterface-impl";
import { Presentation } from "@itwin/presentation-backend";
import { ElectronHost } from "@itwin/core-electron/lib/cjs/ElectronBackend";
import { APP_TITLE, getRpcInterfaces } from "../common/appInfo";
import { MENU_COMMAND_CHANNEL, MENU_MODEL_CHANNEL, type MenuGroup, type MenuModel, parseMenuModel } from "../common/menuIpc";

/** Thin host shim. All graph work happens in the renderer against the `IModelConnection`; the
 * backend opens files, serves tiles and renders the application menu the renderer describes.
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
  setApplicationMenu(undefined);
  IpcHost.addListener(MENU_MODEL_CHANNEL, (_evt, payload: unknown) => {
    try {
      setApplicationMenu(parseMenuModel(payload));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Ignoring malformed application menu from the renderer:", e);
    }
  });
  // Lets the renderer resolve dropped files to paths (File.path no longer exists).
  await app.whenReady();
  session.defaultSession.registerPreloadScript({ type: "frame", filePath: path.join(__dirname, "preload.js") });
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

/** Standard roles (clipboard, zoom, window) plus the renderer's commands. Clicks are sent back to
 * the renderer by command id; the renderer decides what they do. Without a model (before the
 * renderer starts) only the standard roles are shown. */
function setApplicationMenu(model: MenuModel | undefined) {
  const mac = process.platform === "darwin";
  const separator: MenuItemConstructorOptions = { type: "separator" };
  const send = (id: string, arg?: string) => IpcHost.send(MENU_COMMAND_CHANNEL, id, arg);
  const itemsOf = (group: MenuGroup): MenuItemConstructorOptions[] => (model?.items ?? [])
    .filter((i) => i.group === group)
    .map((i): MenuItemConstructorOptions => i.children
      ? { label: i.label, enabled: i.enabled && i.children.length > 0, submenu: i.children.map((c) => ({ label: c.label, click: () => send(i.id, c.arg) })) }
      : { label: i.label, enabled: i.enabled, accelerator: i.accelerator, click: () => send(i.id) });
  const withSeparator = (items: MenuItemConstructorOptions[]) => (items.length > 0 ? [...items, separator] : []);
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" } as const] : []),
    { label: "File", submenu: [...withSeparator(itemsOf("File")), mac ? { role: "close" } : { role: "quit" }] },
    { label: "Edit", submenu: [...withSeparator(itemsOf("Edit")), { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [...withSeparator(itemsOf("View")), { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, separator, { role: "togglefullscreen" }, { role: "toggleDevTools" }] },
    ...(itemsOf("Graph").length > 0 ? [{ label: "Graph", submenu: itemsOf("Graph") }] : []),
    ...(mac ? [{ role: "windowMenu" } as const] : []),
    ...(itemsOf("Help").length > 0 ? [{ role: "help", submenu: itemsOf("Help") } as const] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
