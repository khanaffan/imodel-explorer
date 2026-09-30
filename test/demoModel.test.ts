import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { IModelHost, SnapshotDb } from "@itwin/core-backend";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { createDemoModel, type DemoSummary } from "./demoModel";

const dir = join(__dirname, "..", "dist", "test-output");
const file = join(dir, `demo-${process.pid}.bim`);
const cacheDir = join(dir, `cache-demo-${process.pid}`);
let summary: DemoSummary;
let db: SnapshotDb;

async function rows(ecsql: string): Promise<any[]> {
  const out = [];
  for await (const row of db.createQueryReader(ecsql))
    out.push(row.toRow());
  return out;
}
const scalar = async (ecsql: string) => Object.values((await rows(ecsql))[0])[0];

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  rmSync(file, { force: true });
  await IModelHost.startup({ cacheDir });
  summary = await createDemoModel(file);
  db = SnapshotDb.openFile(file);
});

afterAll(async () => {
  db?.close();
  await IModelHost.shutdown();
  rmSync(file, { force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("demo model (water treatment plant)", () => {
  it("reports what it wrote", async () => {
    expect(summary.elements).toBe(await scalar("SELECT COUNT(*) FROM bis.Element"));
    expect(summary.relationships).toBe(await scalar("SELECT COUNT(*) FROM bis.ElementRefersToElements"));
    expect(summary.elements).toBeGreaterThan(250);
  });

  it("instantiates every concrete domain class", async () => {
    const counts = await rows(`SELECT c.Name cls, COUNT(e.ECInstanceId) n FROM meta.ECClassDef c JOIN meta.ECSchemaDef s ON s.ECInstanceId = c.Schema.Id
      LEFT JOIN bis.Element e ON e.ECClassId = c.ECInstanceId WHERE s.Name = 'WaterPlant' AND c.Type = 0 AND c.Modifier <> 1 GROUP BY c.Name`);
    const empty = counts.filter((r) => r.n === 0).map((r) => r.cls);
    // Aspects are not elements; mixins and abstract bases are excluded by the modifier filter.
    expect(empty.sort()).toEqual(["Inspection", "Nameplate", "OperationsModel"]);
    expect(await scalar("SELECT COUNT(*) FROM wp.Nameplate")).toBe(14);
    expect(await scalar("SELECT COUNT(*) FROM wp.Inspection")).toBe(10);
  });

  it("wires navigation, link-table, grouping and drawing relationships", async () => {
    expect(await scalar("SELECT COUNT(*) FROM wp.Pipe WHERE FromEquipment.Id IS NOT NULL OR ToEquipment.Id IS NOT NULL")).toBe(await scalar("SELECT COUNT(*) FROM wp.Pipe"));
    expect(await scalar("SELECT COUNT(*) FROM wp.Valve WHERE InstalledOn.Id IS NULL")).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM wp.MotorDrivesPump")).toBe(5);
    expect(await scalar("SELECT COUNT(*) FROM bis.ElementGroupsMembers")).toBe(16);
    expect(await scalar("SELECT COUNT(*) FROM bis.DrawingGraphicRepresentsElement")).toBe(45);
    expect(await scalar("SELECT COUNT(*) FROM bis.PhysicalElementAssemblesElements")).toBe(13);
    expect(await scalar("SELECT COUNT(*) FROM wp.Pump WHERE TypeDefinition.Id IS NULL")).toBe(0);
  });

  it("has a distribution header whose fan-out exceeds the default group cap", async () => {
    const [header] = await rows("SELECT ECInstanceId id, ECClassId cls FROM wp.Header WHERE UserLabel = 'H-601'");
    expect(await scalar(`SELECT COUNT(*) FROM wp.Pipe WHERE FromEquipment.Id = ${header.id}`)).toBe(30);
    const engine = await GraphEngine.create(createQueryPort(db as unknown as QuerySource), "relations");
    const graph = await engine.buildNeighbourhood({ classId: header.cls, id: header.id }, DEFAULT_OPTIONS);
    expect([...graph.nodes.values()].some((n) => n.aggregate)).toBe(true);
  });
});
