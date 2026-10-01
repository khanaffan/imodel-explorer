import { graphActions, type Selection, useGraphStore } from "../state/graphStore";

export type GraphTool = "navigate" | "include-relationship" | "exclude-relationship" | "include-class" | "exclude-class" | "exclude-instance" | "include-model" | "exclude-model";

export const GRAPH_TOOLS: ReadonlyArray<{ id: GraphTool; label: string; hint: string }> = [
  { id: "navigate", label: "Navigate", hint: "Click a node to centre on it; Shift-click to inspect." },
  { id: "include-relationship", label: "Include relationship type", hint: "Click an edge or relationship group. Only included types are traversed." },
  { id: "exclude-relationship", label: "Exclude relationship type", hint: "Click an edge or relationship group to exclude its exact type." },
  { id: "include-class", label: "Include node class", hint: "Click a node. Only included classes are traversed." },
  { id: "exclude-class", label: "Exclude node class", hint: "Click a node to exclude all instances of its exact class." },
  { id: "exclude-instance", label: "Exclude this instance", hint: "Click a non-centre node. Excludes paths through it and clears Back/Forward history." },
  { id: "include-model", label: "Include model", hint: "Click a node to include its containing model; sub-models inherit this filter." },
  { id: "exclude-model", label: "Exclude model", hint: "Click a node to exclude its containing model; sub-models inherit this filter." },
];

export interface ToolResult {
  readonly kind: "applied" | "unchanged" | "invalid";
  readonly message: string;
}

export function applyGraphTool(tool: Exclude<GraphTool, "navigate">, target: Exclude<Selection, undefined>): ToolResult {
  const { graph } = useGraphStore.getState();
  const node = target.kind === "node" ? graph.nodes.get(target.key) : undefined;
  const edge = target.kind === "edge" ? graph.edges.get(target.key) : undefined;
  if (!node && !edge) return { kind: "invalid", message: "This target is no longer in the graph." };
  const state = tool.startsWith("include-") ? "include" : "exclude";
  let changed: boolean;
  let name: string;
  if (tool.endsWith("-relationship")) {
    name = edge?.relClassName ?? node?.aggregate?.relClassName ?? "";
    if (!name) return { kind: "invalid", message: "Click a relationship edge or relationship group." };
    changed = graphActions.setFilter("relationships", name, state);
  } else {
    if (!node || node.aggregate) return { kind: "invalid", message: "Click an instance node, not an edge or relationship group." };
    if (tool === "exclude-instance") {
      if (node.key === graph.centreKey) return { kind: "invalid", message: "The centre cannot be excluded. Centre on another instance first." };
      name = `${node.label} (${node.className} ${node.id})`;
      changed = graphActions.excludeInstance(node.key);
    } else if (tool.endsWith("-model")) {
      if (!node.modelId) return { kind: "invalid", message: "This instance has no containing model." };
      name = node.modelName ?? node.modelId;
      changed = graphActions.setFilter("models", node.modelId, state);
    } else {
      name = node.className;
      changed = graphActions.setFilter("classes", name, state);
    }
  }
  const centreHint = node?.key === graph.centreKey && state === "exclude" ? " The centre remains visible." : "";
  return {
    kind: changed ? "applied" : "unchanged",
    message: `${changed ? state === "include" ? "Included" : "Excluded" : "Already " + (state === "include" ? "included" : "excluded")}: ${name}.${centreHint}`,
  };
}
