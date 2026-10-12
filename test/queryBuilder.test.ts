import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyse, cleanQueryError, unbracket } from "../src/frontend/engine/ecsqlParse";
import { ClassRegistry } from "../src/frontend/engine/ClassRegistry";
import { createQueryPort, type IModelQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import {
  addSource, applyJoin, classChoices, connectingSuggestions, connectSources, literalDisplay, findField, formatLiteral, joinSuggestions, operatorsFor, propertyGroups,
} from "../src/frontend/engine/queryContext";
import {
  docFromNative, ensureAlias, printDoc, printSelect, qualifyBare, removeFromItem, removeJoin, renameAlias, type SelectModel, selectFromClass,
} from "../src/frontend/engine/queryModel";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let port: IModelQueryPort;
let registry: ClassRegistry;

beforeAll(async () => {
  fx = await createFixture();
  port = createQueryPort(fx.db as unknown as QuerySource);
  registry = await ClassRegistry.create(port);
});
afterAll(async () => fx?.close());

async function tree(ecsql: string) {
  const r = await analyse(port, ecsql);
  if (r.error !== undefined) throw new Error(`${r.error}\n${ecsql}`);
  return r.tree;
}

const CORPUS = [
  "SELECT ECInstanceId, ECClassId FROM bis.Element",
  "SELECT e.ECInstanceId, m.CodeValue AS ModelCode FROM bis.Element e JOIN bis.Element m ON m.ECInstanceId = e.Model.Id",
  "SELECT p.ECInstanceId FROM tig.Pipe p JOIN tig.Pump u USING tig.PumpOwnsPipes BACKWARD",
  "SELECT u.ECInstanceId FROM tig.Pump u LEFT JOIN tig.PumpFeedsPipe r ON r.SourceECInstanceId = u.ECInstanceId JOIN tig.Pipe p ON p.ECInstanceId = r.TargetECInstanceId WHERE r.FlowRate > 1.5",
  "SELECT e.ECInstanceId FROM bis.Element e CROSS JOIN bis.Model m WHERE e.Model.Id = m.ECInstanceId",
  "SELECT ECInstanceId FROM bis.Element WHERE ECClassId IS (tig.Pump, ONLY tig.Pipe) AND CodeValue IN ('a', 'b''c') AND LastMod BETWEEN '2020-01-01' AND '2030-01-01' AND UserLabel NOT LIKE 'x%' AND Parent.Id IS NULL ORDER BY CodeValue DESC LIMIT 10 OFFSET 2",
  "SELECT ECInstanceId FROM bis.Element WHERE NOT (ECInstanceId > 1 OR ECInstanceId < 0) AND (CodeValue = ? OR UserLabel = :lbl) AND ECClassId IS NOT (tig.Pump) AND UserLabel IS NOT NULL",
  "SELECT DISTINCT ECClassId, COUNT(*) n FROM bis.Element GROUP BY ECClassId HAVING COUNT(*) > 1 UNION SELECT ECClassId, 0 FROM bis.Model EXCEPT SELECT ECClassId, 0 FROM bis.Model WHERE ECInstanceId = 0x1",
  "WITH RECURSIVE c(Id, D) AS (SELECT ECInstanceId, 0 FROM bis.Element WHERE Parent.Id IS NULL UNION ALL SELECT e.ECInstanceId, c.D + 1 FROM bis.Element e JOIN c ON e.Parent.Id = c.Id WHERE c.D < 3) SELECT Id FROM c",
  "SELECT ECInstanceId FROM bis.Element WHERE ECInstanceId IN (SELECT Element.Id FROM bis.ElementMultiAspect) AND EXISTS (SELECT 1 FROM bis.Model m WHERE m.ECInstanceId = Model.Id)",
  "SELECT ECInstanceId, ROW_NUMBER() OVER (PARTITION BY ECClassId ORDER BY ECInstanceId DESC ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) r, COUNT(*) FILTER (WHERE CodeValue IS NULL) OVER (ORDER BY ECInstanceId) c FROM bis.Element",
  "SELECT s.ECInstanceId FROM (SELECT ECInstanceId FROM bis.Element) s, ONLY bis.Model m",
  "SELECT CAST(ECInstanceId AS TEXT), IIF(CodeValue IS NULL, 1, 2), CASE WHEN UserLabel IS NULL THEN 'a' ELSE 'b' END FROM bis.Element WHERE UserLabel LIKE 'a!%' ESCAPE '!' ECSQLOPTIONS NoECClassIdFilter",
];

describe("ECSQL parse and model round-trip", () => {
  it.each(CORPUS)("regenerates an equivalent statement: %s", async (ecsql) => {
    const original = await tree(ecsql);
    const doc = docFromNative(original);
    const printed = printDoc(doc);
    expect(await tree(printed)).toEqual(original);
  });

  it("models joins, CTEs, compounds and conditions structurally", async () => {
    const doc = docFromNative(await tree(CORPUS[3]));
    const sel = doc.main.first;
    expect(sel.from[0].source).toEqual({ kind: "class", className: "TestIG:Pump", alias: "u" });
    expect(sel.from[0].joins.map((j) => [j.kind, j.kind === "on" ? j.type : "", j.source.alias])).toEqual([["on", "LEFT", "r"], ["on", "INNER", "p"]]);
    expect(sel.where).toEqual({ kind: "pred", left: "r.FlowRate", op: ">", args: ["1.5"] });

    const cte = docFromNative(await tree(CORPUS[8]));
    expect(cte.recursive).toBe(true);
    expect(cte.ctes[0]).toMatchObject({ name: "c", columns: ["Id", "D"] });
    expect(cte.ctes[0].query.rest[0].op).toBe("UNION ALL");
    expect(cte.main.first.from[0].source).toEqual({ kind: "cte", name: "c" });

    const using = docFromNative(await tree(CORPUS[2])).main.first.from[0].joins[0];
    expect(using).toEqual({ kind: "using", source: { kind: "class", className: "TestIG:Pump", alias: "u" }, relationship: "TestIG:PumpOwnsPipes", direction: "BACKWARD" });
  });

  it("keeps unmodelled parts as raw chips", async () => {
    const window = docFromNative(await tree(CORPUS[10])).main.first;
    expect(window.columns[1].expr).toMatch(/^ROW_NUMBER\(\) OVER \(PARTITION BY ECClassId ORDER BY ECInstanceId DESC ROWS BETWEEN 2 PRECEDING AND CURRENT ROW\)$/);
    const sub = docFromNative(await tree(CORPUS[9])).main.first.where;
    expect(sub?.kind === "group" && sub.items.map((i) => i.kind)).toEqual(["raw", "raw"]);
    const like = docFromNative(await tree(CORPUS[12])).main.first;
    expect(like.where?.kind).toBe("raw");
    expect(like.options).toBe("NoECClassIdFilter");
    expect(docFromNative(await tree(CORPUS[11])).main.first.from[0].source).toMatchObject({ kind: "raw", alias: "s" });
  });

  it("reports native errors for invalid statements without running anything else", async () => {
    expect(await analyse(port, "SELECT m.CodeValue FROM bis.Model m")).toEqual({ error: expect.stringContaining("m.CodeValue") });
    expect(await analyse(port, "SELECT * FROM bis.Nope")).toEqual({ error: expect.stringContaining("bis.Nope") });
    expect((await analyse(port, "SELECT FROM")).error).toMatch(/syntax error/i);
    expect(await analyse(port, "DELETE FROM bis.Element")).toEqual({ error: "Only SELECT statements are supported." });
    expect(cleanQueryError("Failed to parse ECSQL 'select * from (SELECT FROM\n) limit :a': syntax error")).toBe("syntax error");
  });

  it("handles quotes in the embedded statement", async () => {
    const t = await tree(`SELECT ECInstanceId "x y" FROM bis.Element WHERE CodeValue = 'a''b"c'`);
    expect(printDoc(docFromNative(t))).toContain(`'a''b"c'`);
  });
});

describe("query model editing helpers", () => {
  it("removes redundant brackets but keeps reserved words quoted", () => {
    expect(unbracket("SELECT [e].[Order], [e].[CodeValue] FROM [BisCore].[Element] [e] WHERE [x] = '[y]'")).toBe("SELECT e.[Order], e.CodeValue FROM BisCore.Element e WHERE x = '[y]'");
  });

  it("qualifies bare references before a join and renames aliases everywhere", () => {
    const base: SelectModel = { ...selectFromClass("BisCore:Element"), where: { kind: "pred", left: "Model.Id", op: "=", args: [":Model"] } };
    const { select, alias } = ensureAlias(base, 0, new Set(["ecinstanceid", "ecclassid", "model"]));
    expect(alias).toBe("e");
    expect(select.columns.map((c) => c.expr)).toEqual(["e.ECInstanceId", "e.ECClassId"]);
    expect(select.where).toEqual({ kind: "pred", left: "e.Model.Id", op: "=", args: [":Model"] });
    const renamed = renameAlias(select, "e", "el");
    expect(renamed.columns[0].expr).toBe("el.ECInstanceId");
    expect(renamed.from[0].source.alias).toBe("el");
    expect(qualifyBare("COUNT(ECInstanceId) + 'ECInstanceId'", new Set(["ecinstanceid", "count"]), "x")).toBe("COUNT(x.ECInstanceId) + 'ECInstanceId'");
  });

  it("removing a join drops the terms that reference it", async () => {
    const sel = docFromNative(await tree("SELECT e.ECInstanceId, m.CodeValue FROM bis.Element e JOIN bis.Element m ON m.ECInstanceId = e.Model.Id WHERE m.CodeValue = 'x' AND e.CodeValue IS NOT NULL ORDER BY m.CodeValue")).main.first;
    const out = removeJoin(sel, 0, 0);
    expect(out.from[0].joins).toEqual([]);
    expect(out.columns.map((c) => c.expr)).toEqual(["e.ECInstanceId"]);
    expect(out.where).toEqual({ kind: "group", op: "AND", items: [{ kind: "pred", left: "e.CodeValue", op: "IS NOT NULL", args: [] }] });
    expect(out.orderBy).toEqual([]);
  });
});

describe("query context", () => {
  it("offers populated, queryable classes first", () => {
    const choices = classChoices(registry, new Map([["TestIG:Pump", 3]]));
    expect(choices[0]).toMatchObject({ className: "TestIG:Pump", count: 3, kind: "entity" });
    expect(choices.some((c) => c.className === "TestIG:PumpFeedsPipe" && c.kind === "relationship")).toBe(true);
    expect(choices.some((c) => c.className === "TestIG:Rating")).toBe(false);
  });

  it("suggests relationships that fit the class, with navigation joins where available", () => {
    const fromPipe = joinSuggestions(registry, "TestIG:Pipe");
    const owns = fromPipe.find((x) => x.relationship === "TestIG:PumpOwnsPipes");
    expect(owns).toMatchObject({ direction: "BACKWARD", otherDefault: "TestIG:Pump", navigation: { property: "OwnerPump", holder: "anchor" }, forms: ["navigation", "linkTable", "using"] });
    expect(fromPipe.find((x) => x.relationship === "TestIG:PumpFeedsPipe")).toMatchObject({ direction: "BACKWARD", forms: ["linkTable", "using"] });
    expect(fromPipe.some((x) => x.relationship === "BisCore:ModelContainsElements" && x.navigation?.property === "Model")).toBe(true);
    const fromPump = joinSuggestions(registry, "TestIG:Pump").find((x) => x.relationship === "TestIG:PumpOwnsPipes");
    expect(fromPump).toMatchObject({ direction: "FORWARD", navigation: { holder: "other" } });
    const fromElement = joinSuggestions(registry, "BisCore:Element");
    expect(fromElement.filter((x) => x.relationship === "BisCore:ElementOwnsChildElements").map((x) => x.direction).sort()).toEqual(["BACKWARD", "FORWARD"]);
    expect(fromElement.some((x) => x.relationship === "TestIG:PumpOwnsPipes")).toBe(false);
    expect(connectingSuggestions(registry, "TestIG:Pump", "TestIG:Pipe").map((x) => x.relationship).sort()).toEqual(expect.arrayContaining(["TestIG:PumpFeedsPipe", "TestIG:PumpOwnsPipes"]));
  });

  it.each(["navigation", "linkTable", "using"] as const)("builds a %s join that prepares and returns the related rows", async (form) => {
    for (const [anchor, rel] of [["TestIG:Pipe", "TestIG:PumpOwnsPipes"], ["TestIG:Pump", "TestIG:PumpOwnsPipes"], ["TestIG:Pump", "TestIG:PumpFeedsPipe"]] as const) {
      const suggestion = joinSuggestions(registry, anchor).find((x) => x.relationship === rel)!;
      if (!suggestion.forms.includes(form)) continue;
      const base = selectFromClass(anchor);
      const { select, alias } = applyJoin(registry, base, { anchor: { item: 0 }, suggestion, otherClass: suggestion.otherDefault, form, type: "INNER" });
      const ecsql = printSelect({ ...select, columns: [...select.columns, { expr: `${alias}.ECInstanceId`, alias: "OtherId" }] });
      const analysed = await analyse(port, ecsql);
      expect(analysed.error, ecsql).toBeUndefined();
      const rows = await port.query(ecsql);
      expect(rows.length, ecsql).toBeGreaterThan(0);
    }
  });

  it("groups properties by declaring class with typed, scalar-aware fields", () => {
    const groups = propertyGroups(registry, "TestIG:SmartPump");
    expect(groups[0].title).toBe("System");
    expect(groups[1].title).toBe("SmartPump (own)");
    expect(groups.map((g) => g.title)).toEqual(expect.arrayContaining(["From TestIG:IMonitored", "From BisCore:Element"]));
    expect(groups.findIndex((g) => g.title === "From BisCore:GeometricElement3d")).toBeLessThan(groups.findIndex((g) => g.title === "From BisCore:Element"));
    expect(findField(groups, "Mode")).toMatchObject({ type: "enum", enumValues: [{ value: 0, label: "Off" }, { value: 1, label: "Automatic" }] });
    expect(findField(groups, "Nameplate")).toMatchObject({ type: "struct", scalar: false });
    expect(findField(groups, "Tags")).toMatchObject({ type: "array", scalar: false });
    expect(findField(groups, "Model.Id")).toMatchObject({ type: "id", scalar: true });
    expect(findField(groups, "Origin.Z")).toMatchObject({ type: "number", scalar: true });
    expect(operatorsFor("classId")).toContain("IS");
    expect(operatorsFor("struct")).toEqual([]);
  });

  it("formats typed literals and rejects invalid input", () => {
    expect(formatLiteral("string", "a'b")).toEqual({ ok: true, ecsql: "'a''b'" });
    expect(formatLiteral("number", "1e3")).toEqual({ ok: true, ecsql: "1e3" });
    expect(formatLiteral("number", "x").ok).toBe(false);
    expect(formatLiteral("id", "32")).toEqual({ ok: true, ecsql: "0x20" });
    expect(formatLiteral("dateTime", "2024-01-02")).toEqual({ ok: true, ecsql: "DATE '2024-01-02'" });
    expect(formatLiteral("classId", "only bis:PhysicalElement", undefined, "IS")).toEqual({ ok: true, ecsql: "ONLY bis.PhysicalElement" });
    expect(formatLiteral("string", ":name")).toEqual({ ok: true, ecsql: ":name" });
  });

  it("generated property filters prepare", async () => {
    const groups = propertyGroups(registry, "TestIG:SmartPump");
    const lit = formatLiteral("enum", "Automatic", findField(groups, "Mode"));
    const ecsql = printSelect({ ...selectFromClass("TestIG:SmartPump"), where: { kind: "group", op: "AND", items: [
      { kind: "pred", left: "Mode", op: "=", args: [lit.ok ? lit.ecsql : ""] },
      { kind: "pred", left: "Origin.Z", op: "BETWEEN", args: ["0", "10"] },
      { kind: "pred", left: "ECClassId", op: "IS", args: ["TestIG.SmartPump"] },
      { kind: "pred", left: "LastMod", op: ">", args: ["TIMESTAMP '2020-01-01T00:00:00Z'"] },
    ] } });
    expect((await analyse(port, ecsql)).error, ecsql).toBeUndefined();
  });

  it("relates two existing sources through each suggested relationship", async () => {
    let base = addSource(registry, selectFromClass("TestIG:Pump"), "TestIG:Pipe").select;
    base = { ...base, columns: [{ expr: "p.ECInstanceId" }] };
    for (const sug of connectingSuggestions(registry, "TestIG:Pump", "TestIG:Pipe")) {
      const ecsql = printSelect(connectSources(base, "p", "p2", sug));
      expect((await analyse(port, ecsql)).error, ecsql).toBeUndefined();
    }
  });

  it("removes a FROM item with every reference to it", () => {
    const s = addSource(registry, selectFromClass("TestIG:Pump"), "TestIG:Pipe").select;
    const withRefs: SelectModel = { ...s, columns: [...s.columns, { expr: "p2.ECInstanceId" }], where: { kind: "pred", left: "p2.ECInstanceId", op: "=", args: ["p.ECInstanceId"] } };
    const out = removeFromItem(withRefs, 1);
    expect(printSelect(out)).toBe("SELECT p.ECInstanceId, p.ECClassId\nFROM TestIG.Pump p");
  });

  it("shows literals back as editable values", () => {
    expect(literalDisplay("string", "'it''s'")).toBe("it's");
    expect(literalDisplay("dateTime", "TIMESTAMP '2020-01-01T00:00:00Z'")).toBe("2020-01-01T00:00:00Z");
    expect(literalDisplay("classId", "TestIG.Pump", undefined, "IS")).toBe("TestIG:Pump");
    expect(literalDisplay("number", "a.b")).toBeUndefined();
    expect(literalDisplay("id", ":p")).toBe(":p");
  });
});
