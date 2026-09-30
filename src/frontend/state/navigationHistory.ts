import type { GraphData, GraphEdge } from "../engine/GraphModel";
import type { Pins } from "../engine/pins";

export interface HistoryEntry {
  readonly centreKey: string;
  readonly label: string;
  /** Full snapshot so Back restores instantly without re-querying. */
  readonly graph: GraphData;
  readonly expandedGroups: ReadonlySet<string>;
  readonly pins: Pins;
  readonly pinEdges: ReadonlyMap<string, GraphEdge>;
}

/** Browser-style back/forward over visited centres. Pushing after going back drops the forward
 * branch. Consecutive pushes of the same centre replace rather than duplicate. */
export class NavigationHistory {
  private _entries: HistoryEntry[] = [];
  private _index = -1;

  public constructor(private readonly _limit = 50) { }

  public get current(): HistoryEntry | undefined { return this._entries[this._index]; }
  public get canGoBack(): boolean { return this._index > 0; }
  public get canGoForward(): boolean { return this._index < this._entries.length - 1; }
  public get entries(): readonly HistoryEntry[] { return this._entries; }
  public get index(): number { return this._index; }

  public push(entry: HistoryEntry): void {
    this._entries = this._entries.slice(0, this._index + 1);
    if (this.current?.centreKey === entry.centreKey)
      this._entries[this._index] = entry;
    else
      this._entries.push(entry);
    if (this._entries.length > this._limit)
      this._entries.splice(0, this._entries.length - this._limit);
    this._index = this._entries.length - 1;
  }

  /** Updates the current entry in place, e.g. after expansions around the same centre. */
  public replaceCurrent(entry: HistoryEntry): void {
    if (this._index < 0)
      this.push(entry);
    else
      this._entries[this._index] = entry;
  }

  public back(): HistoryEntry | undefined {
    if (!this.canGoBack) return undefined;
    return this._entries[--this._index];
  }

  public forward(): HistoryEntry | undefined {
    if (!this.canGoForward) return undefined;
    return this._entries[++this._index];
  }

  public clear(): void {
    this._entries = [];
    this._index = -1;
  }
}
