import type { Node } from "@xyflow/react";
import { downloadText, exportPng, graphToCxl, graphToGraphML, graphToJson, safeFileStem, traversalRecipe } from "../services/exporters";
import { colorFor } from "../state/colorTheme";
import { useGraphStore } from "../state/graphStore";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type GraphExportKind = "json" | "graphml" | "cxl" | "png" | "recipe";

export const GRAPH_EXPORTS: ReadonlyArray<{ readonly kind: GraphExportKind; readonly label: string; readonly needsCanvas: boolean }> = [
  { kind: "json", label: "JSON", needsCanvas: false },
  { kind: "graphml", label: "GraphML", needsCanvas: false },
  { kind: "cxl", label: "CmapTools (CXL)", needsCanvas: true },
  { kind: "png", label: "PNG image", needsCanvas: true },
  { kind: "recipe", label: "Copy traversal as ECSQL", needsCanvas: false },
];

/** Exports the instance graph on display. `canvasNodes` are the laid-out canvas nodes, undefined
 * when the canvas is not mounted. Throws when there is nothing to export, so callers can say so. */
export async function exportGraph(kind: GraphExportKind, canvasNodes: Node[] | undefined): Promise<string> {
  const { graph, theme, fileName, options } = useGraphStore.getState();
  if (graph.nodes.size === 0) throw new Error("The graph is empty.");
  const stem = safeFileStem(fileName);
  switch (kind) {
    case "json":
      downloadText(`${stem}-graph.json`, JSON.stringify(graphToJson(graph), null, 2), "application/json");
      return `Exported ${stem}-graph.json`;
    case "graphml":
      downloadText(`${stem}-graph.graphml`, graphToGraphML(graph), "application/xml");
      return `Exported ${stem}-graph.graphml`;
    case "cxl": {
      if (!canvasNodes) throw new Error("Show the instance graph first.");
      const positions = new Map(canvasNodes.map((n) => [n.id, n.position]));
      const cxl = graphToCxl(graph, { title: `${stem} instance graph`, positions, nodeSize: { width: NODE_WIDTH, height: NODE_HEIGHT }, colorOf: (n) => n.aggregate ? undefined : colorFor(n, theme) });
      downloadText(`${stem}-graph.cxl`, cxl, "application/xml");
      return `Exported ${stem}-graph.cxl`;
    }
    case "png": {
      const el = document.querySelector<HTMLElement>(".ig-canvas");
      if (!canvasNodes || !el) throw new Error("Show the instance graph first.");
      await exportPng(`${stem}-graph.png`, canvasNodes, el);
      return `Exported ${stem}-graph.png`;
    }
    case "recipe": {
      const sql = traversalRecipe(graph, options.depth, options.direction);
      if (!sql) throw new Error("This graph has no traversal to describe.");
      await navigator.clipboard.writeText(sql);
      return "Copied the traversal as ECSQL.";
    }
  }
}
