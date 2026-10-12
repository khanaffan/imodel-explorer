// @vitest-environment jsdom
import { SchemaView } from "@itwin/ecschema-metadata";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassRegistry } from "../src/frontend/engine/ClassRegistry";
import { ExpressionEditorDialog } from "../src/frontend/widgets/ExpressionEditorDialog";
import { parseExpression, printExpression, type NodeExpr } from "../src/frontend/engine/nodeExpression";
import {
  compileExpressionGraph, expressionConnectionError, expressionInputs, expressionOutput, expressionToGraph,
  type ExpressionGraph,
} from "../src/frontend/graph/expressionGraph";

function validExpression(graph: ExpressionGraph): NodeExpr | undefined {
  const compiled = compileExpressionGraph(graph);
  if (!compiled.ok) throw new Error(compiled.errors.join("\n"));
  return compiled.expression;
}
function errors(graph: ExpressionGraph): string {
  const compiled = compileExpressionGraph(graph);
  expect(compiled.ok).toBe(false);
  return compiled.errors.join("\n");
}

describe("expression graph conversion", () => {
  it.each([
    "node.label LIKE '%Pump%' AND (CodeValue = 'P-1' OR RatedPower > 5)",
    "NOT (RatedPower IS NULL OR node.category = 'model')",
    "CodeValue IN ('Pump', 'Valve', NULL)",
    "node.id != '0x1' AND node.classId = '0x2'",
    "node.schemaName = 'BisCore' OR node.className = 'BisCore:Element' OR node.modelName IS NOT NULL",
    "RatedPower >= 5 AND RatedPower <= 100 AND RatedPower < 99",
    "Enabled = TRUE AND 5 = 5",
    "ECInstanceId = 0x1 AND Model.Id = 0x2",
  ])("round-trips text, AST, and connected graph: %s", (text) => {
    const expression = parseExpression(text);
    const graph = expressionToGraph(expression);
    expect(validExpression(graph)).toEqual(expression);
    expect(parseExpression(printExpression(validExpression(graph)!))).toEqual(expression);
    expect(graph.nodes.filter((node) => node.data.kind === "result")).toHaveLength(1);
    for (const edge of graph.edges) {
      const source = graph.nodes.find((node) => node.id === edge.source)!;
      const target = graph.nodes.find((node) => node.id === edge.target)!;
      expect(expressionOutput(source.data)?.type).toBe(expressionInputs(target.data).find((port) => port.id === edge.targetHandle)?.type);
    }
  });

  it("treats an empty Result-only graph as clearing the expression", () => {
    expect(validExpression(expressionToGraph())).toBeUndefined();
  });

  it("ignores ephemeral position and selection changes", () => {
    const expression = parseExpression("CodeValue = 'P-1'");
    const graph = expressionToGraph(expression);
    graph.nodes.forEach((node) => { node.position = { x: 1000, y: -30 }; node.selected = true; });
    graph.edges.forEach((edge) => { edge.selected = true; });
    expect(validExpression(graph)).toEqual(expression);
  });

  it("can compile newly authored nodes and connections, not only rendered ASTs", () => {
    const graph = expressionToGraph();
    graph.nodes.push(
      { id: "property", type: "expression", data: { kind: "property", property: "CodeValue" }, position: { x: 0, y: 0 } },
      { id: "literal", type: "expression", data: { kind: "literal", value: "Pump" }, position: { x: 0, y: 0 } },
      { id: "compare", type: "expression", data: { kind: "compare", op: "=" }, position: { x: 0, y: 0 } },
    );
    graph.edges.push(
      { id: "a", source: "property", sourceHandle: "out", target: "compare", targetHandle: "left" },
      { id: "b", source: "literal", sourceHandle: "out", target: "compare", targetHandle: "right" },
      { id: "c", source: "compare", sourceHandle: "out", target: graph.nodes[0].id, targetHandle: "arg" },
    );
    expect(validExpression(graph)).toEqual(parseExpression("CodeValue = 'Pump'"));
    const literal = graph.nodes.find((node) => node.id === "literal")!;
    literal.data = { kind: "literal", value: "Valve" };
    expect(printExpression(validExpression(graph)!)).toBe(printExpression(parseExpression("CodeValue = 'Valve'")));
  });

  it("allows operand and predicate fan-out without changing logical order", () => {
    const expression = parseExpression("CodeValue = 'Pump' OR CodeValue = 'Valve'");
    const graph = expressionToGraph(expression);
    const properties = graph.nodes.filter((node) => node.data.kind === "property");
    const replacement = properties[0].id;
    graph.edges = graph.edges.map((edge) => edge.source === properties[1].id ? { ...edge, source: replacement } : edge);
    graph.nodes = graph.nodes.filter((node) => node.id !== properties[1].id);
    expect(validExpression(graph)).toEqual(expression);
  });

  it("does not mutate or alias input AST arrays", () => {
    const expression: NodeExpr = { kind: "in", left: { prop: "CodeValue" }, values: ["Pump"] };
    const graph = expressionToGraph(expression);
    const compiled = validExpression(graph)!;
    if (compiled.kind !== "in") throw new Error("Expected IN");
    compiled.values.push("Valve");
    expect(expression.values).toEqual(["Pump"]);
    expect(validExpression(graph)).toEqual(expression);
  });
});

describe("expression graph validation", () => {
  it("requires exactly one Result sink", () => {
    expect(errors({ nodes: [], edges: [] })).toContain("exactly one Result");
    const graph = expressionToGraph();
    graph.nodes.push({ ...graph.nodes[0], id: "another-result" });
    expect(errors(graph)).toContain("exactly one Result");
  });

  describe("expression editor controls", () => {
    let root: Root;
    let container: HTMLDivElement;
    let registry: ClassRegistry;
    beforeEach(async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("ResizeObserver", class {
        observe() { }
        unobserve() { }
        disconnect() { }
      });
      vi.stubGlobal("DOMMatrixReadOnly", class { readonly m22 = 1; });
      registry = await ClassRegistry.create({
        query: async () => [],
        getSchemaView: async () => SchemaView.createMergeable(),
      });
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    });
    afterEach(async () => {
      await act(async () => root.unmount());
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      container.remove();
      vi.unstubAllGlobals();
    });
    function button(text: string): HTMLButtonElement {
      const found = Array.from(document.querySelectorAll("button")).find((element) => element.textContent === text);
      if (!found) throw new Error(`Missing button: ${text}`);
      return found;
    }
    function disabled(text: string): boolean {
      const element = button(text);
      return element.disabled || element.getAttribute("aria-disabled") === "true";
    }
    function textarea(label: string): HTMLTextAreaElement {
      const found = Array.from(document.querySelectorAll("textarea")).find((element) => element.getAttribute("aria-label") === label);
      if (!found) throw new Error(`Missing textarea: ${label}`);
      return found;
    }
    function edit(element: HTMLTextAreaElement, value: string) {
      act(() => {
        element.value = value;
        Simulate.change(element);
      });
    }

    it("rebuilds the canvas from text, blocks invalid text, and applies the edited AST", async () => {
      const onApply = vi.fn();
      const onClose = vi.fn();
      await act(async () => root.render(createElement(ExpressionEditorDialog, {
        expression: parseExpression("node.label = 'Pump'"), registry, onApply, onClose,
      })));
      edit(textarea("Expression text"), "node.label = ");
      expect(disabled("Apply")).toBe(true);
      expect(textarea("ECSQL preview").value).toBe("");
      expect(document.querySelector(".ig-expr-errors")?.textContent).toContain("position");
      edit(textarea("Expression text"), "node.label = 'Valve'");
      expect(disabled("Apply")).toBe(false);
      expect(Array.from(document.querySelectorAll(".ig-expr-node__label")).map((element) => element.textContent)).toContain('"Valve"');
      act(() => button("Apply").click());
      expect(onApply).toHaveBeenCalledWith(parseExpression("node.label = 'Valve'"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("edits selected literal nodes and synchronizes text, rejecting malformed scalar drafts", async () => {
      const onApply = vi.fn();
      await act(async () => root.render(createElement(ExpressionEditorDialog, {
        expression: parseExpression("node.label = 'Pump'"), registry, onApply, onClose: vi.fn(),
      })));
      const node = Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node")).find((element) => element.querySelector("strong")?.textContent === "literal");
      if (!node) throw new Error("Missing Literal node");
      act(() => node.click());
      edit(textarea("Value (JSON scalar)"), "{");
      expect(disabled("Apply")).toBe(true);
      edit(textarea("Value (JSON scalar)"), '"Valve"');
      expect(disabled("Apply")).toBe(false);
      expect(parseExpression(textarea("Expression text").value)).toEqual(parseExpression("node.label = 'Valve'"));
      act(() => button("Apply").click());
      expect(onApply).toHaveBeenCalledWith(parseExpression("node.label = 'Valve'"));
    });

    it("exposes unobstructed named handles directly on each node", async () => {
      await act(async () => root.render(createElement(ExpressionEditorDialog, {
        expression: parseExpression("ECInstanceId = 0x1"), registry, onApply: vi.fn(), onClose: vi.fn(),
      })));
      const comparison = [...document.querySelectorAll(".ig-expr-node")].find((el) => el.querySelector("strong")?.textContent === "Compare");
      expect(comparison?.querySelectorAll(":scope > .react-flow__handle")).toHaveLength(3);
      expect(comparison?.querySelector('[aria-label="left input (operand)"]')).not.toBeNull();
      expect(comparison?.querySelector('[aria-label="Output (predicate)"]')).not.toBeNull();
      expect(document.querySelector(".ig-expr-hint")?.textContent).toContain("click the two circles");
    });

    it("preserves click-created connections when the same click selects a node", async () => {
      const onApply = vi.fn();
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
      try {
        await act(async () => root.render(createElement(ExpressionEditorDialog, { registry, onApply, onClose: vi.fn() })));
        const palette = document.querySelector<HTMLSelectElement>(".ig-expr-toolbar select");
        if (!palette) throw new Error("Missing node palette");
        for (const label of ["Field", "Literal", "Compare"]) {
          const option = [...palette.options].find((entry) => entry.text === label);
          if (!option) throw new Error(`Missing ${label} option`);
          act(() => {
            palette.value = option.value;
            Simulate.change(palette);
          });
          act(() => button("Add").click());
        }
        const handle = (kind: string, port: string) => {
          const node = [...document.querySelectorAll(".ig-expr-node")].find((el) => el.querySelector("strong")?.textContent === kind);
          const result = node?.querySelector<HTMLElement>(`[data-handleid="${port}"]`);
          if (!result) throw new Error(`Missing ${kind}.${port} handle`);
          return result;
        };
        for (const [source, target] of [
          [handle("literal", "out"), handle("Compare", "right")],
          [handle("field", "out"), handle("Compare", "left")],
          [handle("Compare", "out"), handle("result", "arg")],
        ]) {
          act(() => source.click());
          act(() => target.click());
        }
        expect(disabled("Apply")).toBe(false);
        expect(parseExpression(textarea("Expression text").value)).toEqual(parseExpression("node.label = ''"));
        act(() => button("Apply").click());
        expect(onApply).toHaveBeenCalledWith(parseExpression("node.label = ''"));
      } finally {
        Reflect.deleteProperty(document, "elementFromPoint");
      }
    });

    it("supports adding/deleting nodes and clearing, while Cancel never applies", async () => {
      const onApply = vi.fn();
      const onClose = vi.fn();
      await act(async () => root.render(createElement(ExpressionEditorDialog, { registry, onApply, onClose })));
      expect(disabled("Apply")).toBe(false);
      act(() => button("Add").click());
      expect(disabled("Apply")).toBe(true);
      expect(document.querySelector(".ig-expr-controls")?.textContent).toContain("Node field");
      act(() => button("Delete node").click());
      expect(disabled("Apply")).toBe(false);
      edit(textarea("Expression text"), "node.label IS NOT NULL");
      act(() => button("Clear expression").click());
      expect(textarea("Expression text").value).toBe("");
      expect(disabled("Apply")).toBe(false);
      act(() => button("Cancel").click());
      expect(onApply).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("reports missing inputs after deleting a connection", () => {
    const graph = expressionToGraph(parseExpression("CodeValue = 'Pump'"));
    graph.edges = graph.edges.filter((edge) => edge.targetHandle !== "right");
    expect(errors(graph)).toContain("connect the right input");
  });

  it("rejects swapped predicate/operand ports", () => {
    const graph = expressionToGraph(parseExpression("CodeValue = 'Pump'"));
    graph.edges.find((edge) => edge.targetHandle === "arg")!.source = graph.nodes.find((node) => node.data.kind === "literal")!.id;
    expect(errors(graph)).toContain("operand ports");
  });

  it("rejects invalid source and target handles", () => {
    const graph = expressionToGraph(parseExpression("CodeValue IS NULL"));
    const edge = graph.edges[0];
    expect(expressionConnectionError({ ...graph, edges: [] }, { ...edge, sourceHandle: null })).toContain("unknown port");
    expect(expressionConnectionError({ ...graph, edges: [] }, { ...edge, targetHandle: "not-a-port" })).toContain("unknown port");
    edge.targetHandle = "not-a-port";
    expect(errors(graph)).toContain("unknown port");
  });

  it("rejects dangling connections", () => {
    const graph = expressionToGraph(parseExpression("CodeValue IS NULL"));
    graph.edges[0].source = "missing";
    expect(errors(graph)).toContain("missing node");
  });

  it("rejects multiply-connected inputs and duplicate ids", () => {
    const graph = expressionToGraph(parseExpression("CodeValue = 'Pump'"));
    expect(expressionConnectionError(graph, graph.edges[0])).toContain("already connected");
    graph.edges.push({ ...graph.edges[0], id: "duplicate-port" });
    expect(errors(graph)).toContain("multiple connections");
    graph.edges.pop();
    graph.nodes.push({ ...graph.nodes[0] });
    expect(errors(graph)).toContain("Node ids must be unique");
    graph.nodes.pop();
    graph.edges.push({ ...graph.edges[0] });
    expect(errors(graph)).toContain("Connection ids must be unique");
  });

  it("detects cycles and rejects cyclic new connections", () => {
    const graph = expressionToGraph(parseExpression("NOT CodeValue IS NULL"));
    const not = graph.nodes.find((node) => node.data.kind === "not")!;
    graph.edges = graph.edges.filter((edge) => edge.target !== not.id);
    const loop = { id: "loop", source: not.id, sourceHandle: "out", target: not.id, targetHandle: "arg" };
    expect(expressionConnectionError(graph, loop)).toContain("cycle");
    graph.edges.push(loop);
    expect(errors(graph)).toContain("cycle");
  });

  it("detects cycles in unused subgraphs too", () => {
    const graph = expressionToGraph(parseExpression("CodeValue IS NULL"));
    graph.nodes.push(
      { id: "a", type: "expression", data: { kind: "not" }, position: { x: 0, y: 0 } },
      { id: "b", type: "expression", data: { kind: "not" }, position: { x: 0, y: 0 } },
    );
    const edge = { id: "ab", source: "a", target: "b", sourceHandle: "out", targetHandle: "arg" };
    graph.edges.push(edge);
    const reverse = { ...edge, id: "ba", source: "b", target: "a" };
    expect(expressionConnectionError(graph, reverse)).toContain("cycle");
    graph.edges.push(reverse);
    expect(errors(graph)).toContain("cycle");
  });

  it("does not silently ignore disconnected nodes", () => {
    const graph = expressionToGraph(parseExpression("CodeValue IS NULL"));
    graph.nodes.push({ id: "unused", type: "expression", data: { kind: "literal", value: "unused" }, position: { x: 0, y: 0 } });
    expect(errors(graph)).toContain("unused");
  });

  it("validates properties, literals, and IN lists structurally", () => {
    const graph = expressionToGraph(parseExpression("CodeValue IN ('Pump')"));
    graph.nodes.find((node) => node.data.kind === "property")!.data = { kind: "property", property: "CodeValue; DROP" };
    expect(errors(graph)).toContain("Invalid expression operand");
    graph.nodes.find((node) => node.data.kind === "property")!.data = { kind: "property", property: "CodeValue" };
    graph.nodes.find((node) => node.data.kind === "in")!.data = { kind: "in", values: [] };
    expect(errors(graph)).toContain("IN requires");
  });
});
