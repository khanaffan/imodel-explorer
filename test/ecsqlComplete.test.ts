import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClassRegistry } from "../src/frontend/engine/ClassRegistry";
import { completeEcsql } from "../src/frontend/engine/ecsqlComplete";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let registry: ClassRegistry;

beforeAll(async () => {
  fx = await createFixture();
  registry = await ClassRegistry.create(createQueryPort(fx.db as unknown as QuerySource));
});
afterAll(async () => fx?.close());

describe("completeEcsql", () => {
  it("suggests schemas, ONLY, and matching classes after FROM", () => {
    const res = completeEcsql("SELECT * FROM ", 14, registry);
    const labels = res.items.map((i) => i.label);
    expect(labels).toContain("ONLY");
    expect(labels).toContain("TestIG.");

    const filtered = completeEcsql("SELECT * FROM Pump", 18, registry);
    expect(filtered.replaceStart).toBe(14);
    expect(filtered.items.some((i) => i.label === "TestIG.Pump")).toBe(true);
  });

  it("completes classes after schema name or schema alias with dot or colon", () => {
    const dot = completeEcsql("SELECT * FROM TestIG.", 21, registry);
    expect(dot.replaceStart).toBe(21);
    expect(dot.items.some((i) => i.label === "Pump" && i.kind === "class")).toBe(true);
    expect(dot.items.some((i) => i.label === "PumpFeedsPipe" && i.kind === "relationship")).toBe(true);

    const aliasColon = completeEcsql("SELECT * FROM tig:Pu", 20, registry);
    expect(aliasColon.replaceStart).toBe(18);
    expect(aliasColon.items.some((i) => i.label === "Pump")).toBe(true);
  });

  it("filters to relationship classes after USING", () => {
    const res = completeEcsql("SELECT p.ECInstanceId FROM TestIG.Pipe p JOIN TestIG.Pump u USING TestIG.", 73, registry);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.kind === "relationship")).toBe(true);
    expect(res.items.some((i) => i.label === "PumpFeedsPipe")).toBe(true);
  });

  it("completes properties on table aliases and sub-members on navigation properties", () => {
    const sql = "SELECT p. FROM TestIG.Pump p";
    const props = completeEcsql(sql, 9, registry);
    expect(props.items.some((i) => i.label === "ECInstanceId" && i.kind === "property")).toBe(true);
    expect(props.items.some((i) => i.label === "UserLabel" && i.kind === "property")).toBe(true);
    expect(props.items.some((i) => i.label === "Model" && i.kind === "property")).toBe(true);

    const navSql = "SELECT p.Model. FROM TestIG.Pump p";
    const navMembers = completeEcsql(navSql, 15, registry);
    expect(navMembers.items.map((i) => i.label)).toEqual(["Id", "RelECClassId"]);
  });

  it("suggests properties of referenced classes in SELECT and WHERE", () => {
    const sql = "SELECT ECInstanceId FROM TestIG.Pump WHERE User";
    const res = completeEcsql(sql, sql.length, registry);
    expect(res.replaceStart).toBe(sql.length - 4);
    expect(res.items.some((i) => i.label === "UserLabel" && i.kind === "property")).toBe(true);
  });

  it("returns no completions inside string literals or comments", () => {
    expect(completeEcsql("SELECT * FROM TestIG.Pump WHERE UserLabel = 'Pu", 47, registry).items).toEqual([]);
    expect(completeEcsql("SELECT * FROM TestIG.Pump -- TestIG.", 36, registry).items).toEqual([]);
    expect(completeEcsql("SELECT * /* TestIG. */ FROM TestIG.Pump", 19, registry).items).toEqual([]);
  });

  it("extends replaceEnd across the full identifier when editing mid-token", () => {
    const res = completeEcsql("SELECT * FROM TestIG.Pump", 3, registry);
    expect(res.replaceStart).toBe(0);
    expect(res.replaceEnd).toBe(6);
    expect(res.items.some((i) => i.label === "SELECT")).toBe(true);
  });

  it("extracts joined aliases even when the preceding FROM source is unaliased", () => {
    const sql = "SELECT p. FROM TestIG.Pump JOIN TestIG.Pipe p ON p.ECInstanceId = 1";
    const res = completeEcsql(sql, 9, registry);
    expect(res.items.some((i) => i.label === "ECInstanceId" && i.kind === "property")).toBe(true);
    expect(res.items.some((i) => i.label === "UserLabel" && i.kind === "property")).toBe(true);
  });

  it("prefers table aliases over schema aliases in expression contexts", () => {
    const sql = "SELECT bis. FROM bis.Element bis";
    const res = completeEcsql(sql, 11, registry);
    expect(res.items.some((i) => i.label === "ECInstanceId" && i.kind === "property")).toBe(true);
    expect(res.items.some((i) => i.kind === "class")).toBe(false);
  });
});
