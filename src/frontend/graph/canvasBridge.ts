import type { Node } from "@xyflow/react";
import type { GraphTool } from "./graphTools";

/** What app commands need from the mounted instance-graph canvas. */
export interface CanvasBridge {
  getNodes(): Node[];
  openFind(): void;
  setTool(tool: GraphTool): void;
  /** Closes the innermost transient state (find bar, then active tool); false when nothing was open. */
  escape(): boolean;
}

let current: CanvasBridge | undefined;

export function setCanvasBridge(bridge: CanvasBridge): () => void {
  current = bridge;
  return () => { if (current === bridge) current = undefined; };
}

export function getCanvasBridge(): CanvasBridge | undefined {
  return current;
}
