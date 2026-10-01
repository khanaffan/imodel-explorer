/** Memory used by the whole app (every Electron process), grouped for the status bar. */
export interface AppMemory {
  readonly totalBytes: number;
  readonly groups: ReadonlyArray<{ readonly label: string; readonly bytes: number }>;
}

/** The fields of Electron's `ProcessMetric` this needs; `workingSetSize` is in kilobytes. */
export interface ProcessMemorySample {
  readonly type: string;
  readonly memory: { readonly workingSetSize: number };
}

const GROUP_LABELS: Readonly<Record<string, string>> = {
  // The iModel backend (native SQLite, ECSQL, tiles) runs in the main process.
  Browser: "Main & iModel backend",
  Tab: "Window",
  GPU: "GPU",
};
const OTHER = "Other";

export function summarizeAppMemory(metrics: readonly ProcessMemorySample[]): AppMemory {
  const byLabel = new Map<string, number>();
  for (const m of metrics) {
    const kb = m.memory.workingSetSize;
    if (!Number.isFinite(kb) || kb < 0) continue;
    const label = GROUP_LABELS[m.type] ?? OTHER;
    byLabel.set(label, (byLabel.get(label) ?? 0) + kb * 1024);
  }
  const order = [...Object.values(GROUP_LABELS), OTHER];
  const groups = order.filter((l) => byLabel.has(l)).map((label) => ({ label, bytes: byLabel.get(label)! }));
  return { totalBytes: groups.reduce((sum, g) => sum + g.bytes, 0), groups };
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
