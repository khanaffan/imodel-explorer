import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { IModelHost, PhysicalModel, SnapshotDb, SpatialCategory } from "@itwin/core-backend";
import { Code, IModel, SubCategoryAppearance } from "@itwin/core-common";

const SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<ECSchema schemaName="TestIG" alias="tig" version="01.00.00" xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.2">
  <ECSchemaReference name="BisCore" version="01.00.00" alias="bis"/>
  <ECEntityClass typeName="Pump">
    <BaseClass>bis:PhysicalElement</BaseClass>
  </ECEntityClass>
  <ECEntityClass typeName="Pipe">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECNavigationProperty propertyName="OwnerPump" relationshipName="PumpOwnsPipes" direction="Backward"/>
  </ECEntityClass>
  <ECEntityClass typeName="PumpSpec">
    <BaseClass>bis:ElementUniqueAspect</BaseClass>
    <ECProperty propertyName="RatedPower" typeName="double"/>
  </ECEntityClass>
  <ECRelationshipClass typeName="PumpOwnsPipes" strength="referencing" modifier="Sealed">
    <Source multiplicity="(0..1)" roleLabel="owns" polymorphic="true"><Class class="Pump"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is owned by" polymorphic="true"><Class class="Pipe"/></Target>
  </ECRelationshipClass>
  <ECRelationshipClass typeName="PumpFeedsPipe" strength="referencing" modifier="Sealed">
    <BaseClass>bis:ElementRefersToElements</BaseClass>
    <Source multiplicity="(0..*)" roleLabel="feeds" polymorphic="true"><Class class="Pump"/></Source>
    <Target multiplicity="(0..*)" roleLabel="is fed by" polymorphic="true"><Class class="Pipe"/></Target>
    <ECProperty propertyName="FlowRate" typeName="double"/>
  </ECRelationshipClass>
</ECSchema>`;

export interface Fixture {
  db: SnapshotDb;
  ids: {
    plantA: string; plantB: string; category: string;
    pump1: string; pump2: string; hub: string;
    pipeA: string; pipeB: string; hubPipes: string[];
  };
  classIds: Record<string, string>;
  close(): Promise<void>;
}

export const HUB_FANOUT = 30;

/** Pump1 -feeds-> PipeA (link table, FlowRate), PipeA -owned by-> Pump1 (nav): a multi-edge pair.
 *  Pump2 -feeds-> PipeA and PipeB; PipeB owned by Pump1: a cycle Pump1-PipeA-Pump2-PipeB-Pump1.
 *  PipeB lives in PlantB, everything else in PlantA. Hub feeds HUB_FANOUT pipes. */
export async function createFixture(opts: { file?: string; keep?: boolean } = {}): Promise<Fixture> {
  const dir = join(__dirname, "..", "dist", "test-output");
  mkdirSync(dir, { recursive: true });
  const file = opts.file ?? join(dir, `ig-fixture-${process.pid}-${Date.now()}.bim`);
  rmSync(file, { force: true });
  if (!IModelHost.isValid)
    // One cache (profile) per worker process: vitest runs test files in parallel forks.
    await IModelHost.startup({ cacheDir: join(dir, `cache-${process.pid}`) });

  const db = SnapshotDb.createEmpty(file, { rootSubject: { name: "InstanceGraph test" } });
  await db.importSchemaStrings([SCHEMA]);
  const plantA = PhysicalModel.insert(db, IModel.rootSubjectId, "PlantA");
  const plantB = PhysicalModel.insert(db, IModel.rootSubjectId, "PlantB");
  const category = SpatialCategory.insert(db, IModel.dictionaryId, "Equipment", new SubCategoryAppearance());

  const insert = (cls: string, model: string, label: string, extra: object = {}) => db.elements.insertElement({
    classFullName: `TestIG:${cls}`, model, category, code: Code.createEmpty(), userLabel: label, ...extra,
  } as any);
  const pump1 = insert("Pump", plantA, "Pump-1");
  const pump2 = insert("Pump", plantA, "Pump-2");
  const hub = insert("Pump", plantA, "Header");
  const own = (id: string) => ({ ownerPump: { id, relClassName: "TestIG:PumpOwnsPipes" } });
  const pipeA = insert("Pipe", plantA, "Pipe-A", own(pump1));
  const pipeB = insert("Pipe", plantB, "Pipe-B", own(pump1));
  const feeds = (sourceId: string, targetId: string, flow: number) =>
    db.relationships.insertInstance({ classFullName: "TestIG:PumpFeedsPipe", sourceId, targetId, flowRate: flow } as any);
  feeds(pump1, pipeA, 12.5);
  feeds(pump2, pipeA, 3);
  feeds(pump2, pipeB, 4);
  const hubPipes: string[] = [];
  for (let i = 0; i < HUB_FANOUT; i++) {
    const p = insert("Pipe", plantA, `Hub-Pipe-${i}`);
    feeds(hub, p, i);
    hubPipes.push(p);
  }
  db.elements.insertAspect({ classFullName: "TestIG:PumpSpec", element: { id: pump1, relClassName: "BisCore:ElementOwnsUniqueAspect" }, ratedPower: 7.5 } as any);
  db.saveChanges();

  const classIds: Record<string, string> = {};
  for await (const row of db.createQueryReader("SELECT c.ECInstanceId Id, s.Name || ':' || c.Name N FROM meta.ECClassDef c JOIN meta.ECSchemaDef s ON s.ECInstanceId = c.Schema.Id WHERE s.Name IN ('TestIG', 'BisCore')"))
    classIds[row.N] = row.Id;

  return {
    db,
    ids: { plantA, plantB, category, pump1, pump2, hub, pipeA, pipeB, hubPipes },
    classIds,
    async close() {
      db.close();
      if (!opts.keep)
        rmSync(file, { force: true });
      if (IModelHost.isValid) {
        await IModelHost.shutdown();
        rmSync(join(dir, `cache-${process.pid}`), { recursive: true, force: true });
      }
    },
  };
}
