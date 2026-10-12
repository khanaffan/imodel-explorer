import type { Connection, Edge, Node } from "@xyflow/react";
import { validateExpression, type NodeExpr, type NodeField, type Operand, type Scalar } from "../engine/nodeExpression";

export type ExpressionNodeData = Record<string, unknown> & (
  | { kind: "field"; field: NodeField }
  | { kind: "property"; property: string }
  | { kind: "literal"; value: Scalar }
  | { kind: "compare"; op: "=" | "!=" | "<" | "<=" | ">" | ">=" }
  | { kind: "like" | "not" | "isNull" | "isNotNull" | "result" }
  | { kind: "in"; values: Scalar[] }
  | { kind: "and" | "or"; inputCount: number }
);
export type ExpressionFlowNode = Node<ExpressionNodeData, "expression">;
export interface ExpressionGraph { nodes: ExpressionFlowNode[]; edges: Edge[] }
export interface ExpressionPort { id: string; type: "operand" | "predicate" }
export type GraphCompilation =
  | { ok: true; expression: NodeExpr | undefined; errors: [] }
  | { ok: false; errors: string[] };

export function expressionInputs(data: ExpressionNodeData): ExpressionPort[] {
  switch (data.kind) {
    case "field": case "property": case "literal": return [];
    case "compare": case "like": return [{ id: "left", type: "operand" }, { id: "right", type: "operand" }];
    case "in": return [{ id: "left", type: "operand" }];
    case "isNull": case "isNotNull": return [{ id: "operand", type: "operand" }];
    case "and": case "or": return Array.from({ length: data.inputCount }, (_, i) => ({ id: `arg-${i}`, type: "predicate" }));
    default: return [{ id: "arg", type: "predicate" }];
  }
}

export function expressionOutput(data: ExpressionNodeData): ExpressionPort | undefined {
  if (data.kind === "result") return undefined;
  return { id: "out", type: ["field", "property", "literal"].includes(data.kind) ? "operand" : "predicate" };
}

function portError(graph: ExpressionGraph, connection: Connection | Edge): string | undefined {
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "A connection references a missing node.";
  const output = expressionOutput(source.data);
  const input = expressionInputs(target.data).find((port) => port.id === connection.targetHandle);
  if (!output || connection.sourceHandle !== output.id || !input) return "A connection references an unknown port.";
  if (input.type !== output.type) return "Connect operand ports to operand ports and predicate ports to predicate ports.";
  return undefined;
}

export function expressionConnectionError(graph: ExpressionGraph, connection: Connection | Edge): string | undefined {
  const error = portError(graph, connection);
  if (error) return error;
  if (graph.edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle))
    return "This input is already connected. Delete its connection first.";
  const pending = [connection.target];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === connection.source) return "This connection would create a cycle.";
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...graph.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return undefined;
}

export function compileExpressionGraph(graph: ExpressionGraph): GraphCompilation {
  const errors: string[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodes.size !== graph.nodes.length) errors.push("Node ids must be unique.");
  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) errors.push("Connection ids must be unique.");
  const results = graph.nodes.filter((node) => node.data.kind === "result");
  if (results.length !== 1) errors.push("The graph must have exactly one Result node.");
  const incoming = new Map<string, Edge>();
  for (const edge of graph.edges) {
    const error = portError(graph, edge);
    if (error) errors.push(error);
    const key = `${edge.target}:${edge.targetHandle}`;
    if (incoming.has(key)) errors.push(`Input ${edge.targetHandle} on ${edge.target} has multiple connections.`);
    incoming.set(key, edge);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function checkCycles(id: string) {
    if (active.has(id)) { errors.push("The graph contains a cycle."); return; }
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of graph.edges.filter((item) => item.target === id)) checkCycles(edge.source);
    active.delete(id);
    visited.add(id);
  }
  for (const node of graph.nodes) checkCycles(node.id);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const result = results[0];
  if (graph.nodes.length === 1 && graph.edges.length === 0) return { ok: true, expression: undefined, errors: [] };
  const used = new Set<string>();
  function input(node: ExpressionFlowNode, port: string): ExpressionFlowNode {
    const edge = incoming.get(`${node.id}:${port}`);
    if (!edge) throw new Error(`${node.data.kind} (${node.id}): connect the ${port} input.`);
    const child = nodes.get(edge.source)!;
    used.add(child.id);
    return child;
  }
  function operand(node: ExpressionFlowNode): Operand {
    switch (node.data.kind) {
      case "field": return { field: node.data.field };
      case "property": return { prop: node.data.property };
      case "literal": return { literal: node.data.value };
      default: throw new Error("Expected a Field, Property, or Literal node.");
    }
  }
  function predicate(node: ExpressionFlowNode): NodeExpr {
    const data = node.data;
    switch (data.kind) {
      case "and": case "or":
        if (!Number.isInteger(data.inputCount) || data.inputCount < 2) throw new Error("AND/OR require at least two inputs.");
        return { kind: data.kind, args: expressionInputs(data).map((port) => predicate(input(node, port.id))) };
      case "not": return { kind: "not", arg: predicate(input(node, "arg")) };
      case "compare": return { kind: "compare", op: data.op, left: operand(input(node, "left")), right: operand(input(node, "right")) };
      case "like": return { kind: "like", left: operand(input(node, "left")), right: operand(input(node, "right")) };
      case "in": return { kind: "in", left: operand(input(node, "left")), values: [...data.values] };
      case "isNull": case "isNotNull": return { kind: data.kind, operand: operand(input(node, "operand")) };
      default: throw new Error("Expected a predicate node.");
    }
  }
  try {
    used.add(result.id);
    const expression = validateExpression(predicate(input(result, "arg")));
    const unused = graph.nodes.filter((node) => !used.has(node.id));
    if (unused.length) throw new Error(`Connect or delete unused nodes: ${unused.map((node) => node.id).join(", ")}.`);
    return { ok: true, expression, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function expressionToGraph(expression?: NodeExpr): ExpressionGraph {
  const graph: ExpressionGraph = { nodes: [], edges: [] };
  const rows = new Map<number, number>();
  function add(data: ExpressionNodeData, depth: number): string {
    const id = `expr-${graph.nodes.length}`;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    graph.nodes.push({ id, type: "expression", data, position: { x: -depth * 240, y: row * 160 }, deletable: data.kind !== "result" });
    return id;
  }
  function connect(source: string, target: string, targetHandle: string) {
    graph.edges.push({ id: `edge-${graph.edges.length}`, source, target, sourceHandle: "out", targetHandle });
  }
  function addOperand(value: Operand, depth: number): string {
    if ("field" in value) return add({ kind: "field", field: value.field }, depth);
    if ("prop" in value) return add({ kind: "property", property: value.prop }, depth);
    return add({ kind: "literal", value: value.literal }, depth);
  }
  function addPredicate(expr: NodeExpr, depth: number): string {
    switch (expr.kind) {
      case "and": case "or": {
        const id = add({ kind: expr.kind, inputCount: expr.args.length }, depth);
        expr.args.forEach((arg, index) => connect(addPredicate(arg, depth + 1), id, `arg-${index}`));
        return id;
      }
      case "not": {
        const id = add({ kind: "not" }, depth);
        connect(addPredicate(expr.arg, depth + 1), id, "arg");
        return id;
      }
      case "compare": case "like": {
        const id = add(expr.kind === "compare" ? { kind: "compare", op: expr.op } : { kind: "like" }, depth);
        connect(addOperand(expr.left, depth + 1), id, "left");
        connect(addOperand(expr.right, depth + 1), id, "right");
        return id;
      }
      case "in": {
        const id = add({ kind: "in", values: [...expr.values] }, depth);
        connect(addOperand(expr.left, depth + 1), id, "left");
        return id;
      }
      case "isNull": case "isNotNull": {
        const id = add({ kind: expr.kind }, depth);
        connect(addOperand(expr.operand, depth + 1), id, "operand");
        return id;
      }
    }
  }
  const result = add({ kind: "result" }, 0);
  if (expression) connect(addPredicate(validateExpression(expression), 1), result, "arg");
  return graph;
}
