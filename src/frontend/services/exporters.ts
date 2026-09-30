import { toPng } from "html-to-image";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { buildTraversalRecipe } from "../engine/ecsql";
import type { Census } from "../engine/census";
import type { DirectionFilter, GraphData, GraphEdge, GraphNode } from "../engine/GraphModel";
import { parseNodeKey } from "../engine/GraphModel";
import { contrastText } from "../state/colorTheme";

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

export interface CxlOptions {
  readonly title?: string;
  /** Top-left position of each node, keyed by node key; missing nodes are laid out on a grid. */
  readonly positions?: ReadonlyMap<string, { x: number; y: number }>;
  readonly nodeSize?: { width: number; height: number };
  /** Background colour (#rrggbb) of a node. */
  readonly colorOf?: (node: GraphNode) => string | undefined;
}

const cxlText = (s: string) => xmlEscape(s).replace(/\n/g, "&#xa;");

function cxlColor(hex: string | undefined): string | undefined {
  const m = hex && /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},255`;
}

/**
 * CXL (Concept Map XML) for IHMC CmapTools: instances become concepts, and each relationship becomes
 * a linking phrase joined to its source and target.
 */
export function graphToCxl(graph: GraphData, opts: CxlOptions = {}): string {
  const { width, height } = opts.nodeSize ?? { width: 180, height: 48 };
  const nodes = [...graph.nodes.values()];
  const conceptId = new Map(nodes.map((n, i) => [n.key, `c${i + 1}`]));
  const centreOf = (key: string, i: number) => {
    const p = opts.positions?.get(key);
    return p ? { x: p.x + width / 2, y: p.y + height / 2 } : { x: (i % 8) * (width + 60) + width / 2, y: Math.floor(i / 8) * (height + 80) + height / 2 };
  };
  const centres = new Map(nodes.map((n, i) => [n.key, centreOf(n.key, i)]));
  const edges = [...graph.edges.values()].filter((e) => conceptId.has(e.source) && conceptId.has(e.target));

  const minX = Math.min(0, ...[...centres.values()].map((p) => p.x - width / 2));
  const minY = Math.min(0, ...[...centres.values()].map((p) => p.y - height / 2));
  const at = (p: { x: number; y: number }) => ({ x: Math.round(p.x - minX + 20), y: Math.round(p.y - minY + 20) });

  const conceptLabel = (n: GraphNode) => n.aggregate ? n.label : `${n.label}\n${n.className} · ${n.id}`;
  const phraseLabel = (e: GraphEdge) => {
    const name = e.relClassName.split(/[.:]/).pop()!;
    const head = e.kind === "navigation" && e.navPropertyName ? `${name}.${e.navPropertyName}` : name;
    return e.cardinality ? `${head}\n${e.cardinality.source} → ${e.cardinality.target}` : head;
  };

  const concepts = nodes.map((n) => `      <concept id="${conceptId.get(n.key)}" label="${cxlText(conceptLabel(n))}"/>`);
  const phrases = edges.map((e, i) => `      <linking-phrase id="l${i + 1}" label="${cxlText(phraseLabel(e))}"/>`);
  const connections = edges.flatMap((e, i) => [
    `      <connection id="k${2 * i + 1}" from-id="${conceptId.get(e.source)}" to-id="l${i + 1}"/>`,
    `      <connection id="k${2 * i + 2}" from-id="l${i + 1}" to-id="${conceptId.get(e.target)}"/>`,
  ]);
  const conceptLooks = nodes.map((n) => {
    const p = at(centres.get(n.key)!);
    const bg = opts.colorOf?.(n);
    const fill = cxlColor(bg);
    const font = bg ? cxlColor(contrastText(bg).replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3")) : undefined;
    const border = graph.centreKey === n.key ? ` border-thickness="3"` : "";
    return `      <concept-appearance id="${conceptId.get(n.key)}" x="${p.x}" y="${p.y}" width="${width}" height="${height}"${fill ? ` background-color="${fill}"` : ""}${font ? ` font-color="${font}"` : ""}${border}/>`;
  });
  const phraseLooks = edges.map((e, i) => {
    const a = at(centres.get(e.source)!);
    const b = at(centres.get(e.target)!);
    return `      <linking-phrase-appearance id="l${i + 1}" x="${Math.round((a.x + b.x) / 2)}" y="${Math.round((a.y + b.y) / 2)}"/>`;
  });
  const connectionLooks = edges.flatMap((e, i) => e.kind === "navigation"
    ? [`      <connection-appearance id="k${2 * i + 1}" style="dashed"/>`, `      <connection-appearance id="k${2 * i + 2}" style="dashed" arrowhead="yes"/>`]
    : [`      <connection-appearance id="k${2 * i + 2}" arrowhead="yes"/>`]);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<cmap xmlns="http://cmap.ihmc.us/xml/cmap/" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `  <res-meta>`,
    `    <dc:title>${xmlEscape(opts.title ?? "Instance graph")}</dc:title>`,
    `    <dc:format>x-cmap/x-storable</dc:format>`,
    `  </res-meta>`,
    `  <map>`,
    `    <concept-list>`, ...concepts, `    </concept-list>`,
    `    <linking-phrase-list>`, ...phrases, `    </linking-phrase-list>`,
    `    <connection-list>`, ...connections, `    </connection-list>`,
    `    <concept-appearance-list>`, ...conceptLooks, `    </concept-appearance-list>`,
    `    <linking-phrase-appearance-list>`, ...phraseLooks, `    </linking-phrase-appearance-list>`,
    `    <connection-appearance-list>`, ...connectionLooks, `    </connection-appearance-list>`,
    `  </map>`,
    `</cmap>`,
  ].join("\n");
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

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Instance census as CSV: one row per class. */
export function censusToCsv(census: Census): string {
  const lines = ["Schema,Class,Kind,Category,Count"];
  for (const e of census.entries)
    lines.push([e.schemaName, e.className, e.kind, e.category, e.count].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

/** Instance census as Markdown: a schema-usage table and a per-class table. */
export function censusToMarkdown(census: Census): string {
  const md = (value: string | number) => String(value).replace(/\|/g, "\\|");
  const lines = [
    "# Instance census", "",
    `Total instances: ${census.totalInstances}`, "",
    "## Schemas", "",
    "| Schema | Classes used | Classes defined | Instances |",
    "| --- | ---: | ---: | ---: |",
    ...census.schemas.map((s) => `| ${md(s.schemaName)} | ${s.classesUsed} | ${s.classesDefined} | ${s.instances} |`),
    "", "## Classes", "",
    "| Class | Kind | Category | Count |",
    "| --- | --- | --- | ---: |",
    ...census.entries.map((e) => `| ${md(e.className)} | ${e.kind} | ${e.category} | ${e.count} |`),
    "",
  ];
  return lines.join("\n");
}
