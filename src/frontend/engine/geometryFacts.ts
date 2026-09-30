/** `Fact[]` builders for the panels around the geometry stream: placement, sub-category appearance,
 * current view state and the iModel's coordinate frame. Pure functions over plain inputs. */
import { Angle, type Range3d, Transform } from "@itwin/core-geometry";
import {
  type EcefLocation, GeometryClass, Placement2d, Placement3d, type PlacementProps, RenderMode,
  type SubCategoryAppearance, type ViewFlags,
} from "@itwin/core-common";
import { type Fact, fmtAngles, fmtPoint, fmtRange, fmtRangeSize, fmtTransform, geometryClassName } from "./geometryStream";

function is2dPlacement(p: PlacementProps): boolean {
  return (p as { angle?: unknown }).angle !== undefined || ((p as { angles?: unknown }).angles === undefined && Array.isArray((p as { origin?: unknown[] }).origin) && ((p as { origin: unknown[] }).origin).length === 2);
}

export interface PlacementSummary {
  readonly facts: Fact[];
  /** Local-to-world transform of the placement. */
  readonly transform: Transform;
  /** Axis-aligned world range of the placed bounding box. */
  readonly worldRange?: Range3d;
  readonly placement: Placement3d | Placement2d;
}

/** Origin, rotation, local bounding box, world range and local→world transform of a placement. */
export function placementFacts(props: PlacementProps | undefined): PlacementSummary | undefined {
  if (!props) return undefined;
  const placement = is2dPlacement(props)
    ? Placement2d.fromJSON(props as Parameters<typeof Placement2d.fromJSON>[0])
    : Placement3d.fromJSON(props as Parameters<typeof Placement3d.fromJSON>[0]);
  const facts: Fact[] = [{ name: "Origin", value: fmtPoint(placement.origin.toJSON()) }];
  if (placement instanceof Placement3d)
    facts.push({ name: "Rotation", value: fmtAngles(placement.angles) });
  else
    facts.push({ name: "Rotation", value: `${placement.angle.degrees.toFixed(2)}°` });

  const bbox = placement.bbox as unknown as Range3d;
  const hasBox = placement.isValid;
  facts.push({ name: "Local bbox", value: hasBox ? fmtRange(bbox) : "—" });
  if (hasBox) facts.push({ name: "Local size", value: fmtRangeSize(bbox) });

  let worldRange: Range3d | undefined;
  if (hasBox) {
    worldRange = placement.calculateRange();
    facts.push({ name: "World range", value: fmtRange(worldRange) });
  }
  const transform = placement.transform;
  if (!transform.isIdentity)
    for (const [i, row] of fmtTransform(transform).entries())
      facts.push({ name: i === 0 ? "Local → world" : "", value: row });
  return { facts, transform, worldRange, placement };
}

/** The sub-category's base appearance: what geometry inherits unless the stream overrides it. */
export function subCategoryFacts(app: SubCategoryAppearance, subCategoryId: string): Fact[] {
  const facts: Fact[] = [
    { name: "Sub-category", value: subCategoryId },
    { name: "Colour", value: app.color.toHexString(), swatch: app.color.toHexString() },
    { name: "Weight", value: String(app.weight) },
  ];
  if (app.styleId) facts.push({ name: "Line style", value: app.styleId });
  if (app.transparency !== 0) facts.push({ name: "Transparency", value: String(app.transparency) });
  if (app.priority !== 0) facts.push({ name: "Priority", value: String(app.priority) });
  if (app.materialId) facts.push({ name: "Material", value: app.materialId });
  if (app.invisible) facts.push({ name: "Invisible", value: "true" });
  return facts;
}

const RENDER_MODE_NAMES: Record<number, string> = {
  [RenderMode.Wireframe]: "Wireframe", [RenderMode.HiddenLine]: "Hidden line",
  [RenderMode.SolidFill]: "Solid fill", [RenderMode.SmoothShade]: "Smooth shade",
};

/** What the viewport can accept: the minimal surface of Viewport used by {@link viewFacts}. */
export interface ViewFactsInput {
  readonly viewsCategory: (id: string) => boolean;
  readonly isSubCategoryVisible: (id: string) => boolean;
  readonly viewFlags: ViewFlags;
  /** World range of the current frustum. */
  readonly frustumRange?: Range3d;
}

/** Whether the element's category/sub-category/geometry classes draw in the given view, and whether
 * its world range is inside the current frustum. */
export function viewFacts(vp: ViewFactsInput, opts: {
  categoryId?: string;
  subCategoryIds: readonly string[];
  geometryClasses: ReadonlySet<GeometryClass>;
  worldRange?: Range3d;
}): Fact[] {
  const facts: Fact[] = [];
  if (opts.categoryId)
    facts.push({ name: "Category displayed", value: String(vp.viewsCategory(opts.categoryId)) });
  for (const sc of opts.subCategoryIds)
    facts.push({ name: `Sub-category ${sc}`, value: vp.isSubCategoryVisible(sc) ? "visible" : "hidden" });
  const gcOff: string[] = [];
  for (const gc of opts.geometryClasses) {
    if (gc === GeometryClass.Construction && !vp.viewFlags.constructions) gcOff.push("Construction");
    if (gc === GeometryClass.Dimension && !vp.viewFlags.dimensions) gcOff.push("Dimension");
    if (gc === GeometryClass.Pattern && !vp.viewFlags.patterns) gcOff.push("Pattern");
  }
  if (gcOff.length)
    facts.push({ name: "Geometry classes off", value: gcOff.join(", ") });
  else if (opts.geometryClasses.size > 0)
    facts.push({ name: "Geometry classes", value: [...opts.geometryClasses].map(geometryClassName).join(", ") });
  facts.push({ name: "Render mode", value: RENDER_MODE_NAMES[vp.viewFlags.renderMode] ?? String(vp.viewFlags.renderMode) });
  if (opts.worldRange && vp.frustumRange)
    facts.push({ name: "In view volume", value: String(vp.frustumRange.intersectsRange(opts.worldRange)) });
  return facts;
}

/** What the iModel connection must provide for {@link imodelFrameFacts}. */
export interface FrameFactsInput {
  readonly projectExtents: Range3d;
  readonly globalOrigin: { toJSON: () => unknown };
  readonly ecefLocation?: EcefLocation;
  readonly isGeoLocated: boolean;
  readonly geographicCoordinateSystem?: { horizontalCRS?: { id?: string; name?: string } };
}

/** The iModel's coordinate frame: extents, global origin and geolocation. */
export function imodelFrameFacts(iModel: FrameFactsInput): Fact[] {
  const facts: Fact[] = [
    { name: "Project extents", value: fmtRange(iModel.projectExtents) },
    { name: "Extents size", value: fmtRangeSize(iModel.projectExtents) },
    { name: "Global origin", value: fmtPoint(iModel.globalOrigin.toJSON() as Parameters<typeof fmtPoint>[0]) },
    { name: "Geolocated", value: String(iModel.isGeoLocated) },
  ];
  const gcs = iModel.geographicCoordinateSystem?.horizontalCRS;
  if (gcs?.id || gcs?.name)
    facts.push({ name: "Coordinate system", value: gcs.name ?? gcs.id ?? "" });
  const ecef = iModel.ecefLocation;
  if (ecef) {
    facts.push({ name: "ECEF origin", value: fmtPoint(ecef.origin.toJSON()) });
    const c = ecef.cartographicOrigin;
    if (c)
      facts.push({
        name: "Cartographic origin",
        value: `${Angle.radiansToDegrees(c.latitude).toFixed(6)}°, ${Angle.radiansToDegrees(c.longitude).toFixed(6)}°, ${c.height.toFixed(2)} m`,
      });
  }
  return facts;
}
