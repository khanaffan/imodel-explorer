import { describe, expect, it } from "vitest";
import { evaluateExpression, expressionPreview, parseExpression, printExpression, validateExpression } from "../src/frontend/engine/nodeExpression";
import { filterCount, EMPTY_FILTERS, isFilterEmpty } from "../src/frontend/engine/filters";
import { captureSession, parseSession } from "../src/frontend/services/sessionStore";
import { DEFAULT_OPTIONS } from "../src/frontend/engine/GraphEngine";
import { emptyGraph, type GraphNode } from "../src/frontend/engine/GraphModel";
import { buildExpressionPropertyQuery } from "../src/frontend/engine/ecsql";

const node: GraphNode = {
  key: "0x1:0x2", id: "0x2", classId: "0x1", label: "Pump's label", category: "model",
  className: "Test:Pump", schemaName: "Test", classHierarchy: [], depth: 1, expanded: false,
};
describe("node expressions", () => {
  it.each([
    "node.label LIKE '%Pump%' AND (RatedPower >= 7.5 OR RatedPower IS NULL)",
    "NOT (node.category IN ('model', 'aspect'))",
    "node.id = 0x2 OR UserLabel = 'Pump''s label'",
    "Value NOT IN (1, 2, NULL) AND node.label NOT LIKE 'x%'",
    "Flag = TRUE AND Value <> -1.25e2",
    "ECInstanceId = 0x2 AND ECClassId IN (0x1, 0x3)",
    "Model.Id = 0x12 OR OwnerPump.RelECClassId IS NULL",
  ])("round trips %s", (text) => {
    const expr = parseExpression(text);
    expect(parseExpression(printExpression(expr))).toEqual(expr);
    expect(validateExpression(JSON.parse(JSON.stringify(expr)))).toEqual(expr);
  });
  it("implements NULL-aware OR, AND, NOT and IN", () => {
    const run = (text: string) => evaluateExpression(parseExpression(text), node);
    expect(run("RatedPower IS NULL OR node.category = 'model'")).toBe(true);
    expect(run("RatedPower > 1 OR node.category = 'model'")).toBe(true);
    expect(run("RatedPower > 1 AND node.category = 'other'")).toBe(false);
    expect(run("NOT (RatedPower > 1)")).toBeNull();
    expect(run("node.label IN ('no', NULL)")).toBeNull();
    expect(run("node.modelName IS NULL")).toBe(true);
    expect(run("node.label LIKE 'pump''s _abel'")).toBe(true);
    expect(run("ecinstanceid = 0x2 AND ECCLASSID = 0x1")).toBe(true);
    expect(run("Model.Id IS NULL")).toBe(true);
  });
  it.each(["node.nope = 1", "x = ", "x IN ()", "x = 1; DROP TABLE x", "x = foo.bar", "x = 1e999"])("rejects %s", (text) => {
    expect(() => parseExpression(text)).toThrow();
  });
  it("rejects malformed persisted expressions and excessive nesting", () => {
    expect(() => validateExpression({ kind: "compare", op: "=", left: { prop: "x]; DROP" }, right: { literal: 1 } })).toThrow();
    expect(() => parseExpression(`${"NOT ".repeat(100)}x = 1`)).toThrow();
  });
  it("counts and persists expressions, rejecting corrupt session ASTs", () => {
    const filters = { ...EMPTY_FILTERS, expression: parseExpression("node.category = 'model'") };
    expect(isFilterEmpty(filters)).toBe(false);
    expect(filterCount(filters)).toBe(1);
    const graph = { ...emptyGraph(node.key), nodes: new Map([[node.key, node]]) };
    const saved = captureSession("expression", "model.bim", graph, { ...DEFAULT_OPTIONS, filters }, "radial")!;
    expect(parseSession(JSON.parse(JSON.stringify(saved))).filters.expression).toEqual(filters.expression);
    expect(() => parseSession({ ...saved, filters: { ...filters, expression: { kind: "eval" } } })).toThrow();
    expect(parseSession({ ...saved, filters: EMPTY_FILTERS }).filters.expression).toBeUndefined();
  });
  it("marks previews that cannot be translated honestly", () => {
    expect(expressionPreview(parseExpression("RatedPower > 5"))).toContain("$->[RatedPower]");
    expect(expressionPreview(parseExpression("node.label = 'Pump'"))).toContain("Not executable");
    const preview = expressionPreview(parseExpression("ECInstanceId = 0x2 AND Model.Id = 0x12"));
    expect(preview).toContain("[ECInstanceId]");
    expect(preview).toContain("[Model].[Id]");
  });
  it("rejects untrusted SQL identifiers and ids", () => {
    expect(() => buildExpressionPropertyQuery("Test:Pump", "UserLabel] FROM bis.Element", ["0x1"])).toThrow();
    expect(() => buildExpressionPropertyQuery("Test:Pump;DROP", "UserLabel", ["0x1"])).toThrow();
    expect(() => buildExpressionPropertyQuery("Test:Pump", "UserLabel", ["0x1) OR TRUE"])).toThrow();
    expect(buildExpressionPropertyQuery("Test:Pump", "UserLabel", ["0x1", "0x2"])).toContain("FROM ONLY [Test].[Pump] WHERE ECInstanceId IN (0x1,0x2)");
    expect(buildExpressionPropertyQuery("Test:Pump", "Model.Id", ["0x1"])).toContain("[Model].[Id] V");
    expect(() => buildExpressionPropertyQuery("Test:Pump", "Model.Id.More", ["0x1"])).toThrow();
    expect(() => buildExpressionPropertyQuery("Test:Pump", "Model.Id] OR 1=1", ["0x1"])).toThrow();
  });
});
