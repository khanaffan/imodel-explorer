import { ElectronApp } from "@itwin/core-electron/renderer";

/** Everything the UI needs from its host. Electron implements it today; a Studio host would
 * provide its own file picker and storage behind the same interface. */
export interface AppHost {
  readonly name: string;
  pickIModelFile(): Promise<string | undefined>;
  getRecentFiles(): string[];
  addRecentFile(path: string): void;
  removeRecentFile(path: string): void;
  /** The on-disk path of a file dropped on the window; undefined when it has none. */
  pathForDroppedFile(file: File): string | undefined;
}

/** Exposed by src/backend/preload.ts. */
interface HostBridge { pathForFile(file: File): string }
declare global { interface Window { imodelExplorerHost?: HostBridge } }

export const IMODEL_EXTENSIONS: readonly string[] = ["bim", "ibim", "imodel"];

/** Why `path` cannot be opened as an iModel, judged by its name; undefined when it looks fine. */
export function iModelPathProblem(path: string): string | undefined {
  if (!path) return "No file was given.";
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext && IMODEL_EXTENSIONS.includes(ext) ? undefined
    : `${path.split(/[\\/]/).pop()} is not an iModel (expected ${IMODEL_EXTENSIONS.map((e) => `.${e}`).join(", ")}).`;
}

const RECENT_KEY = "instanceGraph.recentFiles";
const MAX_RECENT = 10;

class ElectronAppHost implements AppHost {
  public readonly name = "electron";

  public async pickIModelFile(): Promise<string | undefined> {
    const result = await ElectronApp.dialogIpc.showOpenDialog({
      title: "Open iModel",
      properties: ["openFile"],
      filters: [{ name: "iModels", extensions: [...IMODEL_EXTENSIONS] }, { name: "All files", extensions: ["*"] }],
    });
    return result.canceled ? undefined : result.filePaths[0];
  }

  public getRecentFiles(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  public addRecentFile(path: string): void {
    const list = [path, ...this.getRecentFiles().filter((p) => p !== path)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  public pathForDroppedFile(file: File): string | undefined {
    const bridge = window.imodelExplorerHost;
    if (!bridge) throw new Error("File drop is unavailable: the host preload did not load.");
    return bridge.pathForFile(file) || undefined;
  }

  public removeRecentFile(path: string): void {
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.getRecentFiles().filter((p) => p !== path)));
  }
}

export const appHost: AppHost = new ElectronAppHost();
