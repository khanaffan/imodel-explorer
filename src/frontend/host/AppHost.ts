import { ElectronApp } from "@itwin/core-electron/renderer";

/** Everything the UI needs from its host. Electron implements it today; a Studio host would
 * provide its own file picker and storage behind the same interface. */
export interface AppHost {
  readonly name: string;
  pickIModelFile(): Promise<string | undefined>;
  getRecentFiles(): string[];
  addRecentFile(path: string): void;
  removeRecentFile(path: string): void;
}

const RECENT_KEY = "instanceGraph.recentFiles";
const MAX_RECENT = 10;

class ElectronAppHost implements AppHost {
  public readonly name = "electron";

  public async pickIModelFile(): Promise<string | undefined> {
    const result = await ElectronApp.dialogIpc.showOpenDialog({
      title: "Open iModel",
      properties: ["openFile"],
      filters: [{ name: "iModels", extensions: ["bim", "ibim", "imodel"] }, { name: "All files", extensions: ["*"] }],
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

  public removeRecentFile(path: string): void {
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.getRecentFiles().filter((p) => p !== path)));
  }
}

export const appHost: AppHost = new ElectronAppHost();
