import { ElectronApp } from "@itwin/core-electron/renderer";
import type { AppMemory } from "../../common/appMemory";
import { IMODEL_EXTENSIONS } from "../../common/iModelFiles";

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
  /** Whether `path` names an existing file, checked before closing the open iModel for it. */
  fileExists(path: string): Promise<boolean>;
  /** Memory used by every process of the app. */
  appMemory(): Promise<AppMemory>;
}

/** Exposed by src/backend/preload.ts. */
interface HostBridge {
  pathForFile(file: File): string;
  fileExists(path: string): Promise<boolean>;
  appMemory(): Promise<unknown>;
}
declare global { interface Window { imodelExplorerHost?: HostBridge } }

function parseAppMemory(value: unknown): AppMemory {
  const v = value as Partial<AppMemory> | null;
  const isBytes = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!v || !isBytes(v.totalBytes) || !Array.isArray(v.groups)
    || !v.groups.every((g) => g && typeof g.label === "string" && isBytes(g.bytes)))
    throw new Error("The host returned malformed memory figures.");
  return { totalBytes: v.totalBytes, groups: v.groups.map((g) => ({ label: g.label, bytes: g.bytes })) };
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

  public async fileExists(path: string): Promise<boolean> {
    const bridge = window.imodelExplorerHost;
    if (!bridge) throw new Error("Cannot check files: the host preload did not load.");
    return bridge.fileExists(path);
  }

  public async appMemory(): Promise<AppMemory> {
    const bridge = window.imodelExplorerHost;
    if (!bridge) throw new Error("Memory use is unavailable: the host preload did not load.");
    return parseAppMemory(await bridge.appMemory());
  }

  public removeRecentFile(path: string): void {
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.getRecentFiles().filter((p) => p !== path)));
  }
}

export const appHost: AppHost = new ElectronAppHost();
