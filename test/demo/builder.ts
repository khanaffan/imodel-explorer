import { type SnapshotDb, SpatialCategory, SubCategory } from "@itwin/core-backend";
import {
  Code, ColorDef, FillDisplay, GeometryParams, type GeometryStreamProps, GeometryStreamBuilder, IModel,
  SubCategoryAppearance,
} from "@itwin/core-common";
import {
  AngleSweep, Arc3d, Box, Cone, type GeometryQuery, LineString3d, Loop, Point3d, Range3d, Sphere, Transform,
} from "@itwin/core-geometry";

export type XYZ = [number, number, number];

/** Builds a geometry stream from world coordinates, stored relative to the element origin. */
export class Shape {
  private readonly _b = new GeometryStreamBuilder();
  private readonly _toLocal: Transform;

  public constructor(private readonly _category: string, public readonly origin: XYZ) {
    this._toLocal = Transform.createTranslationXYZ(-origin[0], -origin[1], -origin[2]);
    this._b.appendGeometryRanges();
  }

  /** Switches subsequent geometry to a subcategory, optionally filling planar regions. */
  public sub(subCategory: string, fill = false): this {
    const params = new GeometryParams(this._category, subCategory);
    if (fill)
      params.fillDisplay = FillDisplay.Always;
    this._b.appendGeometryParamsChange(params);
    return this;
  }

  public add(g: GeometryQuery | undefined): this {
    if (!g)
      throw new Error("Degenerate demo geometry");
    g.tryTransformInPlace(this._toLocal);
    this._b.appendGeometry(g);
    return this;
  }

  public box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.add(Box.createRange(Range3d.createXYZXYZ(x0, y0, z0, x1, y1, z1), true));
  }

  public cyl(a: XYZ, b: XYZ, r: number): this {
    return this.cone(a, b, r, r);
  }

  public cone(a: XYZ, b: XYZ, ra: number, rb: number): this {
    return this.add(Cone.createAxisPoints(Point3d.create(...a), Point3d.create(...b), ra, rb, true));
  }

  public sphere(c: XYZ, r: number, upperHalfOnly = false): this {
    const sweep = upperHalfOnly ? AngleSweep.createStartEndDegrees(0, 90) : undefined;
    return this.add(Sphere.createCenterRadius(Point3d.create(...c), r, sweep, true));
  }

  /** Horizontal filled disk (e.g. a water surface). */
  public disk(c: XYZ, r: number): this {
    return this.add(Loop.create(Arc3d.createXY(Point3d.create(...c), r)));
  }

  public circle(c: XYZ, r: number): this {
    return this.add(Arc3d.createXY(Point3d.create(...c), r));
  }

  public polygon(points: XYZ[]): this {
    return this.add(Loop.createPolygon(points.map((p) => Point3d.create(...p))));
  }

  public line(points: XYZ[]): this {
    return this.add(LineString3d.create(points.map((p) => Point3d.create(...p))));
  }

  /** Pipe run through `points`, with a sphere at each bend so elbows look continuous. */
  public run(points: XYZ[], r: number): this {
    for (let i = 1; i < points.length; i++) {
      this.cyl(points[i - 1], points[i], r);
      if (i < points.length - 1)
        this.sphere(points[i], r);
    }
    return this;
  }

  public get stream(): GeometryStreamProps {
    return this._b.geometryStream;
  }
}

export interface CategoryDef {
  id: string;
  subs: Record<string, string>;
}

/** Inserts a spatial category whose default subcategory takes the first colour, plus named subcategories. */
export function insertSpatialCategory(db: SnapshotDb, name: string, colors: Record<string, string>, transparency: Record<string, number> = {}): CategoryDef {
  const [firstName, firstColor] = Object.entries(colors)[0];
  const id = SpatialCategory.insert(db, IModel.dictionaryId, name, appearance(firstColor, transparency[firstName]));
  const subs: Record<string, string> = {};
  for (const [sub, color] of Object.entries(colors))
    subs[sub] = SubCategory.insert(db, id, sub, appearance(color, transparency[sub]));
  return { id, subs };
}

export function appearance(hex: string, transp = 0): SubCategoryAppearance {
  return new SubCategoryAppearance({ color: ColorDef.fromString(hex).toJSON(), transp });
}

/** Inserts elements and tracks them by label so later passes can wire relationships. */
export class ElementWriter {
  private readonly _byLabel = new Map<string, string>();

  public constructor(public readonly db: SnapshotDb) {}

  public insert(classFullName: string, model: string, label: string, props: Record<string, unknown> = {}): string {
    if (this._byLabel.has(label))
      throw new Error(`Duplicate demo label ${label}`);
    const id = this.db.elements.insertElement({
      classFullName, model, code: Code.createEmpty(), userLabel: label, ...props,
    } as any);
    this._byLabel.set(label, id);
    return id;
  }

  /** Inserts a 3D element whose placement origin and geometry come from `shape`. */
  public physical(classFullName: string, model: string, category: CategoryDef, label: string, shape: Shape, props: Record<string, unknown> = {}): string {
    return this.insert(classFullName, model, label, {
      category: category.id, placement: { origin: shape.origin, angles: {} }, geom: shape.stream, ...props,
    });
  }

  public id(label: string): string {
    const id = this._byLabel.get(label);
    if (!id)
      throw new Error(`Unknown demo element ${label}`);
    return id;
  }

  public link(classFullName: string, source: string, target: string, props: Record<string, unknown> = {}): string {
    return this.db.relationships.insertInstance({
      classFullName, sourceId: this.id(source), targetId: this.id(target), ...props,
    } as any);
  }

  public get count(): number {
    return this._byLabel.size;
  }
}
