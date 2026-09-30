import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GeometryPart, IModelHost, PhysicalModel, SnapshotDb, SpatialCategory, SubCategory } from "@itwin/core-backend";
import {
  Code, ColorDef, GeometryParams, type GeometryPartProps, GeometryStreamBuilder, IModel,
  SubCategoryAppearance, TextString,
} from "@itwin/core-common";
import { Arc3d, Box, Cone, LineString3d, Point3d, Range3d } from "@itwin/core-geometry";

const SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<ECSchema schemaName="TestIG" alias="tig" version="01.00.00" xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.2">
  <ECSchemaReference name="BisCore" version="01.00.00" alias="bis"/>
  <ECSchemaReference name="CoreCustomAttributes" version="01.00.00" alias="CoreCA"/>
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
  <ECEnumeration typeName="PumpMode" backingTypeName="int" isStrict="true">
    <ECEnumerator name="Off" value="0" displayLabel="Off"/>
    <ECEnumerator name="Auto" value="1" displayLabel="Automatic"/>
  </ECEnumeration>
  <ECStructClass typeName="Rating">
    <ECProperty propertyName="Value" typeName="double"/>
  </ECStructClass>
  <ECEntityClass typeName="IMonitored" modifier="Abstract">
    <ECCustomAttributes>
      <IsMixin xmlns="CoreCustomAttributes.01.00.00"><AppliesToEntityClass>bis:PhysicalElement</AppliesToEntityClass></IsMixin>
    </ECCustomAttributes>
    <ECProperty propertyName="SensorId" typeName="string"/>
  </ECEntityClass>
  <!-- Never instantiated: exercises the Schema widget's type formatting. -->
  <ECEntityClass typeName="SmartPump" description="A pump with telemetry">
    <BaseClass>Pump</BaseClass>
    <BaseClass>IMonitored</BaseClass>
    <ECProperty propertyName="Mode" typeName="PumpMode"/>
    <ECProperty propertyName="Manual" typeName="string" extendedTypeName="URI" readOnly="true"/>
    <ECArrayProperty propertyName="Tags" typeName="string"/>
    <ECStructProperty propertyName="Nameplate" typeName="Rating"/>
    <ECStructArrayProperty propertyName="Ratings" typeName="Rating" minOccurs="1" maxOccurs="4"/>
  </ECEntityClass>
  <ECEntityClass typeName="IAudited" modifier="Abstract">
    <ECCustomAttributes>
      <IsMixin xmlns="CoreCustomAttributes.01.00.00"><AppliesToEntityClass>bis:PhysicalElement</AppliesToEntityClass></IsMixin>
    </ECCustomAttributes>
    <ECProperty propertyName="AuditedBy" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="ICalibrated" modifier="Abstract">
    <ECCustomAttributes>
      <IsMixin xmlns="CoreCustomAttributes.01.00.00"><AppliesToEntityClass>bis:PhysicalElement</AppliesToEntityClass></IsMixin>
    </ECCustomAttributes>
    <BaseClass>IAudited</BaseClass>
  </ECEntityClass>
  <!-- Inherits IMonitored from SmartPump; ICalibrated brings its base mixin IAudited. -->
  <ECEntityClass typeName="SmartPumpMk2">
    <BaseClass>SmartPump</BaseClass>
    <BaseClass>ICalibrated</BaseClass>
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
    geomPart: string; trimSubCat: string;
  };
  classIds: Record<string, string>;
  close(): Promise<void>;
}

export const HUB_FANOUT = 30;

/** Raw op keys of Pump-1's persisted geometry stream, in order. */
export const PUMP1_STREAM_KEYS = [
  "header", "appearance", "subRange", "box", "subRange", "lineString",
  "appearance", "geomPart", "subRange", "arc", "subRange", "textString",
] as const;

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
  const trimSubCat = SubCategory.insert(db, category, "Trim",
    new SubCategoryAppearance({ color: ColorDef.blue.toJSON(), weight: 2 }));

  // A reusable part (box + arc) referenced from Pump-1's stream.
  const partBuilder = new GeometryStreamBuilder();
  partBuilder.appendGeometry(Box.createRange(Range3d.createXYZXYZ(-0.5, -0.5, 0, 0.5, 0.5, 0.8), true)!);
  partBuilder.appendGeometry(Arc3d.createXY(Point3d.create(0, 0, 0.8), 0.4));
  const geomPart = db.elements.insertElement({
    classFullName: GeometryPart.classFullName,
    model: IModel.dictionaryId,
    code: GeometryPart.createCode(db, IModel.dictionaryId, "PumpBody"),
    geom: partBuilder.geometryStream,
  } as GeometryPartProps);

  /** Pump-1's stream: Trim+red override → box, line string → reset → part ref → arc → text. */
  const pump1Stream = () => {
    const b = new GeometryStreamBuilder();
    b.appendGeometryRanges();
    const trimParams = new GeometryParams(category, trimSubCat);
    trimParams.lineColor = ColorDef.red;
    b.appendGeometryParamsChange(trimParams);
    b.appendGeometry(Box.createRange(Range3d.createXYZXYZ(0, 0, 0, 2, 1, 1), true)!);
    b.appendGeometry(LineString3d.create([0, 0, 1], [2, 0, 1], [2, 1, 1]));
    b.appendGeometryParamsChange(new GeometryParams(category));
    b.appendGeometryPart3d(geomPart, Point3d.create(0.5, 0.5, 1));
    b.appendGeometry(Arc3d.createXY(Point3d.create(1, 0.5, 2), 0.5));
    b.appendTextString(new TextString({ text: "P-1", font: 1, height: 0.3, origin: Point3d.create(0, -0.5, 0) }));
    return b.geometryStream;
  };
  const pipeStream = (length: number, radius: number) => {
    const b = new GeometryStreamBuilder();
    b.appendGeometry(Cone.createAxisPoints(Point3d.create(0, 0, 0), Point3d.create(length, 0, 0), radius, radius, true)!);
    return b.geometryStream;
  };

  const insert = (cls: string, model: string, label: string, extra: object = {}) => db.elements.insertElement({
    classFullName: `TestIG:${cls}`, model, category, code: Code.createEmpty(), userLabel: label, ...extra,
  } as any);
  const pump1 = insert("Pump", plantA, "Pump-1", {
    placement: { origin: [1, 2, 0], angles: { yaw: 30 } }, geom: pump1Stream(),
  });
  const pump2 = insert("Pump", plantA, "Pump-2");
  const hub = insert("Pump", plantA, "Header");
  const own = (id: string) => ({ ownerPump: { id, relClassName: "TestIG:PumpOwnsPipes" } });
  const pipeA = insert("Pipe", plantA, "Pipe-A", {
    ...own(pump1), placement: { origin: [3, 2, 0.5], angles: {} }, geom: pipeStream(3, 0.2),
  });
  const pipeB = insert("Pipe", plantB, "Pipe-B", {
    ...own(pump1), placement: { origin: [6, 2, 0.5], angles: { yaw: 90 } }, geom: pipeStream(2, 0.15),
  });
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
    ids: { plantA, plantB, category, pump1, pump2, hub, pipeA, pipeB, hubPipes, geomPart, trimSubCat },
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
