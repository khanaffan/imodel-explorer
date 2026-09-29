import { toPng } from "html-to-image";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { buildTraversalRecipe } from "../engine/ecsql";
import type { DirectionFilter, GraphData } from "../engine/GraphModel";
import { parseNodeKey } from "../engine/GraphModel";

export interface GraphJson {
  readonly format: "instance-graph";
  readonly version: 1;
  readonly centre: string;
  readonly truncated: boolean;
  readonly nodes: ReadonlyArray<Record<string, unknown>>;
  readonly edges: ReadonlyArray<Record<string, unknown>>;
}

export function graphToJson(graph: GraphData): GraphJson {
  return {
    format: "instance-graph",
    version: 1,
    centre: graph.centreKey,
    truncated: graph.truncated,
    nodes: [...graph.nodes.values()].map((n) => ({
      key: n.key, id: n.id, classId: n.classId, className: n.className, label: n.label, category: n.category,
      modelId: n.modelId, modelName: n.modelName, depth: n.depth, aggregate: n.aggregate,
    })),
    edges: [...graph.edges.values()].map((e) => ({
      key: e.key, source: e.source, target: e.target, kind: e.kind, relClassName: e.relClassName, relClassId: e.relClassId,
      relInstanceId: e.relInstanceId, navPropertyName: e.navPropertyName, cardinality: e.cardinality,
    })),
  };
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[c]!);

/** GraphML for yEd, Gephi, Cytoscape and friends. */
export function graphToGraphML(graph: GraphData): string {
  const keys: Array<[string, "node" | "edge", string]> = [
    ["label", "node", "label"], ["className", "node", "className"], ["instanceId", "node", "instanceId"], ["model", "node", "model"],
    ["category", "node", "category"], ["depth", "node", "depth"],
    ["relationship", "edge", "relationship"], ["kind", "edge", "kind"], ["navProperty", "edge", "navProperty"], ["cardinality", "edge", "cardinality"],
  ];
  const data = (k: string, v: unknown) => (v === undefined || v === "" ? "" : `<data key="${k}">${xmlEscape(String(v))}</data>`);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<graphml xmlns="http://graphml.graphdrawing.org/xmlns">`,
    ...keys.map(([id, forWhat, name]) => `  <key id="${id}" for="${forWhat}" attr.name="${name}" attr.type="${id === "depth" ? "int" : "string"}"/>`),
    `  <graph id="G" edgedefault="directed">`,
    ...[...graph.nodes.values()].map((n) => `    <node id="${xmlEscape(n.key)}">${data("label", n.label)}${data("className", n.className)}${data("instanceId", n.id)}${data("model", n.modelName)}${data("category", n.category)}${data("depth", n.depth)}</node>`),
    ...[...graph.edges.values()].map((e) => `    <edge id="${xmlEscape(e.key)}" source="${xmlEscape(e.source)}" target="${xmlEscape(e.target)}">${data("relationship", e.relClassName)}${data("kind", e.kind)}${data("navProperty", e.navPropertyName)}${data("cardinality", e.cardinality ? `${e.cardinality.source} → ${e.cardinality.target}` : undefined)}</edge>`),
    `  </graph>`,
    `</graphml>`,
  ];
  return lines.join("\n");
}

/** ECSQL that reproduces the traversal from the current centre, for use outside this tool. */
export function traversalRecipe(graph: GraphData, depth: number, direction: DirectionFilter): string | undefined {
  if (!graph.centreKey) return undefined;
  return buildTraversalRecipe(parseNodeKey(graph.centreKey), depth, direction);
}

export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  downloadUrl(fileName, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadUrl(fileName: string, url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Renders the whole graph (not just the visible part) to PNG. */
export async function exportPng(fileName: string, nodes: Node[], container: HTMLElement): Promise<void> {
  const viewportEl = container.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl || nodes.length === 0) return;
  const bounds = getNodesBounds(nodes);
  const pad = 40;
  const width = Math.min(8000, Math.ceil(bounds.width + pad * 2));
  const height = Math.min(8000, Math.ceil(bounds.height + pad * 2));
  const vp = getViewportForBounds(bounds, width, height, 0.05, 2, pad / Math.max(width, height));
  const dataUrl = await toPng(viewportEl, {
    backgroundColor: getComputedStyle(container).backgroundColor || "#ffffff",
    width, height,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
  });
  downloadUrl(fileName, dataUrl);
}

export function safeFileStem(name: string | undefined): string {
  const base = (name ?? "graph").split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  return base.replace(/[^\w.-]+/g, "_") || "graph";
}
