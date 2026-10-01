/** Parses a GeometryStream (the JSON form returned by `loadProps({ wantGeometry: true })`) into a
 * readable display model: every op in stream order, with resolved symbology, formatted primitive
 * facts and part references. Pure — no RPC, no React. */
import {
  type AnyGeometryQuery, Arc3d, BagOfCurves, Box, BSplineCurve3d, BSplineCurve3dH, BSplineSurface3d, BSplineSurface3dH, Cone,
  CoordinateXYZ, CurveCollection, type CurvePrimitive, IModelJson, IndexedPolyface, InterpolationCurve3d, LinearSweep, LineSegment3d,
  LineString3d, Loop, ParityRegion, Path, PointString3d, Range3d, RotationalSweep, RuledSweep, Sphere, TorusPipe, Transform,
  TransitionSpiral3d, UnionRegion, type XYZProps, YawPitchRollAngles,
} from "@itwin/core-geometry";
import {
  BackgroundFill, BRepEntity, ColorDef, FillDisplay, GeometricElement3dProps, GeometryClass, GeometryParams,
  type GeometryStreamEntryProps, GeometryStreamFlags, GeometryStreamIterator, type GeometryStreamIteratorEntry,
  type GeometryStreamProps, type PlacementProps, SubCategoryAppearance, type TextStringProps,
} from "@itwin/core-common";
import type { InstanceReference } from "./instanceProperties";

export type StreamOpKind =
  | "header" | "appearance" | "styleMod" | "fill" | "pattern" | "material" | "subRange"
  | "partReference" | "textString" | "image" | "brep" | "geometry" | "unknown";

/** A name/value pair shown in the op detail and fact panels. */
export interface Fact {
  readonly name: string;
  readonly value: string;
  readonly reference?: InstanceReference;
  /** Colour swatch to render beside the value. */
  readonly swatch?: string;
  /** Whether this appearance value overrides the sub-category or is inherited from it. */
  readonly tag?: "override" | "inherited";
}

/** Resolved symbology at a primitive, for the op rows. */
export interface AppearanceSnapshot {
  readonly subCategoryId: string;
  readonly color?: string;
  readonly weight?: number;
  readonly transparency?: number;
  readonly geometryClass: GeometryClass;
  readonly materialId?: string;
}

export interface StreamOp {
  /** Index into the raw `geom` array. */
  readonly index: number;
  readonly kind: StreamOpKind;
  readonly label: string;
  /** One-line summary shown in the collapsed row. */
  readonly detail?: string;
  readonly facts: Fact[];
  readonly isPrimitive: boolean;
  /** GeometryPart id when kind is "partReference". */
  readonly partId?: string;
  /** Resolved params/transform at a part reference, used to parse the part's own stream. */
  readonly partParams?: GeometryParams;
  readonly partToWorld?: Transform;
  /** Local range: the stored subRange for the next primitive, or the primitive's own range. */
  readonly localRange?: Range3d;
  /** Resolved symbology (primitives only). */
  readonly appearance?: AppearanceSnapshot;
  readonly counts?: { points?: number; facets?: number; children?: number };
  /** Set when the iterator could not parse this entry; the op is shown from its raw JSON only. */
  readonly notParsed?: boolean;
  readonly raw: GeometryStreamEntryProps;
}

export interface StreamSummary {
  readonly totalOps: number;
  readonly byKind: ReadonlyMap<StreamOpKind, number>;
  readonly primitives: number;
  readonly points: number;
  readonly facets: number;
  readonly distinctParts: number;
  readonly hasBRep: boolean;
  readonly viewIndependent: boolean;
}

export interface ParsedStream {
  readonly ops: StreamOp[];
  readonly summary: StreamSummary;
  /** Distinct part ids in first-reference order. */
  readonly parts: string[];
}

/** The context a stream is parsed in. Element streams supply placement + category; part streams
 * supply the params/transform of the referencing entry so inherited symbology is right. */
export type StreamContext =
  | { readonly kind: "element3d"; readonly placement?: PlacementProps; readonly category: string }
  | { readonly kind: "element2d"; readonly placement?: PlacementProps; readonly category: string }
  | { readonly kind: "part"; readonly params?: GeometryParams; readonly transform?: Transform };

const MODIFIER_KINDS: ReadonlyArray<[string, StreamOpKind]> = [
  ["header", "header"],
  ["appearance", "appearance"],
  ["styleMod", "styleMod"],
  ["fill", "fill"],
  ["pattern", "pattern"],
  ["material", "material"],
  ["subRange", "subRange"],
  ["geomPart", "partReference"],
  ["textString", "textString"],
  ["brep", "brep"],
  ["image", "image"],
];

/** IModelJson keys that denote a geometry primitive entry. */
const GEOMETRY_KEYS = new Set([
  "lineSegment", "lineString", "arc", "bcurve", "interpolationCurve", "transitionSpiral",
  "path", "loop", "parityRegion", "unionRegion", "bagOfCurves", "curveCollection",
  "indexedMesh", "bsurf", "point", "pointString",
  "box", "sphere", "cone", "cylinder", "torusPipe", "linearSweep", "rotationalSweep", "ruledSweep",
]);

const PRIMITIVE_KINDS = new Set<StreamOpKind>(["partReference", "textString", "brep", "image", "geometry"]);

export function classifyOp(entry: GeometryStreamEntryProps): { kind: StreamOpKind; key: string } {
  for (const [key, kind] of MODIFIER_KINDS)
    if ((entry as Record<string, unknown>)[key] !== undefined)
      return { kind, key };
  for (const key of Object.keys(entry))
    if (GEOMETRY_KEYS.has(key))
      return { kind: "geometry", key };
  return { kind: "unknown", key: Object.keys(entry)[0] ?? "?" };
}

// --- formatting helpers ------------------------------------------------------------------------

const num = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e7 || a < 1e-4)) return n.toExponential(3);
  return String(Math.round(n * 10000) / 10000);
};

export function fmtPoint(p: XYZProps | undefined): string {
  if (p === undefined) return "—";
  if (Array.isArray(p)) return `(${p.map((v) => num(Number(v))).join(", ")})`;
  const o = p as { x?: number; y?: number; z?: number };
  return `(${num(o.x ?? 0)}, ${num(o.y ?? 0)}, ${num(o.z ?? 0)})`;
}

export function fmtRange(r: Range3d | undefined): string {
  if (!r || r.isNull) return "—";
  return `${fmtPoint(r.low.toJSON())} to ${fmtPoint(r.high.toJSON())}`;
}

export function fmtRangeSize(r: Range3d | undefined): string {
  if (!r || r.isNull) return "—";
  return `${num(r.xLength())} × ${num(r.yLength())} × ${num(r.zLength())}`;
}

export function fmtAngles(a: YawPitchRollAngles): string {
  return `yaw ${num(a.yaw.degrees)}° pitch ${num(a.pitch.degrees)}° roll ${num(a.roll.degrees)}°`;
}

export function fmtTransform(t: Transform): string[] {
  const m = t.matrix;
  const o = t.origin;
  return [0, 1, 2].map((i) =>
    `[${num(m.at(i, 0))} ${num(m.at(i, 1))} ${num(m.at(i, 2))} | ${num(o.at(i))}]`);
}

export function fmtColor(props: number | string | undefined): { value: string; swatch?: string } {
  if (props === undefined) return { value: "—" };
  const c = ColorDef.fromJSON(props as number);
  return { value: c.toHexString(), swatch: c.toHexString() };
}

const GEOMETRY_CLASS_NAMES: Record<number, string> = {
  [GeometryClass.Primary]: "Primary",
  [GeometryClass.Construction]: "Construction",
  [GeometryClass.Dimension]: "Dimension",
  [GeometryClass.Pattern]: "Pattern",
};
export const geometryClassName = (gc: GeometryClass | undefined): string => GEOMETRY_CLASS_NAMES[gc ?? GeometryClass.Primary] ?? String(gc);

const FILL_DISPLAY_NAMES: Record<number, string> = {
  [FillDisplay.Never]: "Never", [FillDisplay.ByView]: "By view", [FillDisplay.Always]: "Always", [FillDisplay.Blanking]: "Blanking",
};
const BREP_TYPE_NAMES: Record<number, string> = {
  [BRepEntity.Type.Solid]: "Solid", [BRepEntity.Type.Sheet]: "Sheet", [BRepEntity.Type.Wire]: "Wire",
};

// --- geometry description ----------------------------------------------------------------------

export interface GeometryDescription {
  readonly label: string;
  readonly detail: string;
  readonly facts: Fact[];
  readonly counts?: { points?: number; facets?: number; children?: number };
  readonly range?: Range3d;
}

function curveLengthFact(c: CurvePrimitive): Fact {
  return { name: "Length", value: num(c.curveLength()) };
}

function collectionDetail(c: CurveCollection): { detail: string; children: number } {
  const kids = c.children ?? [];
  const kinds = new Map<string, number>();
  for (const k of kids) {
    const name = describeGeometry(k as AnyGeometryQuery).label;
    kinds.set(name, (kinds.get(name) ?? 0) + 1);
  }
  const detail = [...kinds].map(([n, ct]) => (ct > 1 ? `${ct}× ${n}` : n)).join(", ");
  return { detail, children: kids.length };
}

/** A readable label, one-line detail and facts for any core-geometry query object. */
export function describeGeometry(g: AnyGeometryQuery): GeometryDescription {
  const range = g.range();
  const base = (label: string, detail: string, facts: Fact[] = [], counts?: GeometryDescription["counts"]): GeometryDescription =>
    ({ label, detail, facts, counts, range });

  if (g instanceof LineSegment3d)
    return base("Line segment", `${fmtPoint(g.point0Ref.toJSON())} → ${fmtPoint(g.point1Ref.toJSON())}`, [
      { name: "Start", value: fmtPoint(g.point0Ref.toJSON()) },
      { name: "End", value: fmtPoint(g.point1Ref.toJSON()) },
      curveLengthFact(g),
    ]);
  if (g instanceof LineString3d)
    return base("Line string", `${g.numPoints()} points`, [
      { name: "Points", value: String(g.numPoints()) },
      { name: "Start", value: fmtPoint(g.startPoint().toJSON()) },
      { name: "End", value: fmtPoint(g.endPoint().toJSON()) },
      curveLengthFact(g),
    ], { points: g.numPoints() });
  if (g instanceof Arc3d) {
    const r = g.circularRadius();
    return base("Arc", r !== undefined ? `r ${num(r)}, sweep ${num(g.sweep.sweepDegrees)}°` : `elliptical, sweep ${num(g.sweep.sweepDegrees)}°`, [
      { name: "Centre", value: fmtPoint(g.center.toJSON()) },
      ...(r !== undefined
        ? [{ name: "Radius", value: num(r) }]
        : [{ name: "Vector 0", value: fmtPoint(g.vector0.toJSON()) }, { name: "Vector 90", value: fmtPoint(g.vector90.toJSON()) }]),
      { name: "Sweep", value: `${num(g.sweep.startDegrees)}° to ${num(g.sweep.endDegrees)}°` },
      curveLengthFact(g),
    ]);
  }
  if (g instanceof BSplineCurve3d || g instanceof BSplineCurve3dH)
    return base("B-spline curve", `order ${g.order}, ${g.numPoles} poles`, [
      { name: "Order", value: String(g.order) },
      { name: "Poles", value: String(g.numPoles) },
      curveLengthFact(g),
    ], { points: g.numPoles });
  if (g instanceof InterpolationCurve3d)
    return base("Interpolation curve", `${g.options.fitPoints.length} fit points`, [
      { name: "Fit points", value: String(g.options.fitPoints.length) },
      curveLengthFact(g),
    ]);
  if (g instanceof TransitionSpiral3d)
    return base("Transition spiral", g.spiralType ?? "spiral", [curveLengthFact(g)]);
  if (g instanceof PointString3d)
    return base("Point string", `${g.points.length} points`, [{ name: "Points", value: String(g.points.length) }], { points: g.points.length });
  if (g instanceof CoordinateXYZ)
    return base("Point", fmtPoint(g.point.toJSON()), [{ name: "Point", value: fmtPoint(g.point.toJSON()) }]);

  if (g instanceof Loop || g instanceof Path || g instanceof ParityRegion || g instanceof UnionRegion || g instanceof BagOfCurves) {
    const label = g instanceof Loop ? "Loop" : g instanceof Path ? "Path" : g instanceof ParityRegion ? "Parity region" : g instanceof UnionRegion ? "Union region" : "Curve bag";
    const { detail, children } = collectionDetail(g);
    return base(label, detail || `${children} children`, [{ name: "Children", value: detail || String(children) }], { children });
  }

  if (g instanceof IndexedPolyface)
    return base("Mesh", `${g.pointCount} points, ${g.facetCount} facets`, [
      { name: "Points", value: String(g.pointCount) },
      { name: "Facets", value: String(g.facetCount) },
      { name: "Normals", value: g.normalCount > 0 ? String(g.normalCount) : "none" },
      { name: "Params", value: g.paramCount > 0 ? String(g.paramCount) : "none" },
      { name: "Colours", value: g.colorCount > 0 ? String(g.colorCount) : "none" },
    ], { points: g.pointCount, facets: g.facetCount });
  if (g instanceof BSplineSurface3d || g instanceof BSplineSurface3dH)
    return base("B-spline surface", `${g.numPolesUV(0)} × ${g.numPolesUV(1)} poles`, [
      { name: "Order (u, v)", value: `${g.orderUV(0)}, ${g.orderUV(1)}` },
      { name: "Poles (u, v)", value: `${g.numPolesUV(0)}, ${g.numPolesUV(1)}` },
    ], { points: g.numPolesUV(0) * g.numPolesUV(1) });

  if (g instanceof Box) {
    const basePt = g.getBaseOrigin();
    const height = g.getTopOrigin().distance(basePt);
    return base("Box", `${num(g.getBaseX())} × ${num(g.getBaseY())} × ${num(height)}`, [
      { name: "Base origin", value: fmtPoint(basePt.toJSON()) },
      { name: "Base size", value: `${num(g.getBaseX())} × ${num(g.getBaseY())}` },
      { name: "Top size", value: `${num(g.getTopX())} × ${num(g.getTopY())}` },
      { name: "Height", value: num(height) },
      { name: "Capped", value: String(g.capped) },
    ]);
  }
  if (g instanceof Sphere) {
    const r = g.trueSphereRadius();
    return base("Sphere", r !== undefined ? `r ${num(r)}` : "ellipsoid", [
      { name: "Centre", value: fmtPoint(g.cloneCenter().toJSON()) },
      { name: "Radius", value: r !== undefined ? num(r) : "ellipsoidal" },
    ]);
  }
  if (g instanceof Cone)
    return base("Cone", `r ${num(g.getRadiusA())} → ${num(g.getRadiusB())}`, [
      { name: "Centre A", value: fmtPoint(g.getCenterA().toJSON()) },
      { name: "Centre B", value: fmtPoint(g.getCenterB().toJSON()) },
      { name: "Radius A", value: num(g.getRadiusA()) },
      { name: "Radius B", value: num(g.getRadiusB()) },
      { name: "Capped", value: String(g.capped) },
    ]);
  if (g instanceof TorusPipe)
    return base("Torus pipe", `R ${num(g.getMajorRadius())}, r ${num(g.getMinorRadius())}`, [
      { name: "Centre", value: fmtPoint(g.cloneCenter().toJSON()) },
      { name: "Major radius", value: num(g.getMajorRadius()) },
      { name: "Minor radius", value: num(g.getMinorRadius()) },
      { name: "Sweep", value: `${num(g.getSweepAngle().degrees)}°` },
      { name: "Capped", value: String(g.capped) },
    ]);
  if (g instanceof LinearSweep) {
    const v = g.cloneSweepVector();
    const contour = describeGeometry(g.getCurvesRef() as AnyGeometryQuery);
    return base("Linear sweep", `${contour.label} swept ${num(v.magnitude())}`, [
      { name: "Contour", value: `${contour.label} — ${contour.detail}` },
      { name: "Sweep vector", value: fmtPoint(v.toJSON()) },
      { name: "Capped", value: String(g.capped) },
    ]);
  }
  if (g instanceof RotationalSweep) {
    const axis = g.cloneAxisRay();
    return base("Rotational sweep", `${num(g.getSweep().degrees)}° about ${fmtPoint(axis.direction.toJSON())}`, [
      { name: "Axis origin", value: fmtPoint(axis.origin.toJSON()) },
      { name: "Axis direction", value: fmtPoint(axis.direction.toJSON()) },
      { name: "Sweep", value: `${num(g.getSweep().degrees)}°` },
      { name: "Capped", value: String(g.capped) },
    ]);
  }
  if (g instanceof RuledSweep)
    return base("Ruled sweep", `${g.sweepContoursRef().length} contours`, [
      { name: "Contours", value: String(g.sweepContoursRef().length) },
      { name: "Capped", value: String(g.capped) },
    ]);

  // Anything new or unusual still shows up with its type name and range.
  return base(g.geometryCategory ?? "Geometry", "", []);
}

// --- appearance description --------------------------------------------------------------------

function snapshotOf(params: GeometryParams, baseline?: SubCategoryAppearance): AppearanceSnapshot {
  const color = params.lineColor ?? baseline?.color;
  return {
    subCategoryId: params.subCategoryId,
    color: color?.toHexString(),
    weight: params.weight ?? baseline?.weight,
    transparency: params.elmTransparency ?? baseline?.transparency,
    geometryClass: params.geometryClass ?? GeometryClass.Primary,
    materialId: params.materialId ?? baseline?.materialId,
  };
}

/** Facts for the resolved GeometryParams at a primitive. Values set on the params override the
 * sub-category; values taken from `baseline` are inherited from it. */
export function describeAppearance(params: GeometryParams, baseline?: SubCategoryAppearance): Fact[] {
  const facts: Fact[] = [{ name: "Sub-category", value: params.subCategoryId, reference: { id: params.subCategoryId, targetBaseClass: "BisCore:SubCategory" } }];
  const pick = <T>(name: string, override: T | undefined, inherited: T | undefined, fmt: (v: T) => Pick<Fact, "value" | "swatch" | "reference">) => {
    if (override !== undefined) facts.push({ name, ...fmt(override), tag: "override" });
    else if (inherited !== undefined) facts.push({ name, ...fmt(inherited), tag: "inherited" });
  };
  const asColor = (c: ColorDef) => ({ value: c.toHexString(), swatch: c.toHexString() });
  const asText = (v: string | number | boolean) => ({ value: String(v) });

  pick("Colour", params.lineColor, baseline?.color, asColor);
  pick("Weight", params.weight, baseline?.weight, asText);
  pick("Style", params.styleInfo?.styleId, baseline?.styleId, (id) => ({ value: id, reference: { id, targetBaseClass: "BisCore:LineStyle" } }));
  pick("Transparency", params.elmTransparency, baseline?.transparency, asText);
  pick("Material", params.materialId, baseline?.materialId, (id) => ({ value: id, reference: { id, targetBaseClass: "BisCore:RenderMaterial" } }));
  if (params.geometryClass !== undefined && params.geometryClass !== GeometryClass.Primary)
    facts.push({ name: "Geometry class", value: geometryClassName(params.geometryClass), tag: "override" });
  if (params.fillDisplay !== undefined && params.fillDisplay !== FillDisplay.Never) {
    facts.push({ name: "Fill display", value: FILL_DISPLAY_NAMES[params.fillDisplay] ?? String(params.fillDisplay), tag: "override" });
    if (params.gradient) facts.push({ name: "Fill", value: "gradient", tag: "override" });
    else if (params.backgroundFill !== undefined && params.backgroundFill !== BackgroundFill.None)
      facts.push({ name: "Fill", value: params.backgroundFill === BackgroundFill.Outline ? "background (outline)" : "background", tag: "override" });
    else if (params.fillColor) facts.push({ name: "Fill colour", ...asColor(params.fillColor), tag: "override" });
  }
  if (params.pattern) facts.push({ name: "Area pattern", value: "yes", tag: "override" });
  return facts;
}

// --- modifier op facts -------------------------------------------------------------------------

function modifierFacts(key: string, entry: GeometryStreamEntryProps): { detail: string; facts: Fact[] } {
  const raw = (entry as Record<string, unknown>)[key] as Record<string, unknown>;
  switch (key) {
    case "header": {
      const flags = (raw as { flags: GeometryStreamFlags }).flags;
      const vi = (flags & GeometryStreamFlags.ViewIndependent) !== 0;
      return { detail: vi ? "view-independent" : "default flags", facts: [{ name: "View independent", value: String(vi) }] };
    }
    case "appearance": {
      const facts: Fact[] = [];
      if (raw.subCategory !== undefined) facts.push({ name: "Sub-category", value: String(raw.subCategory), reference: { id: String(raw.subCategory), targetBaseClass: "BisCore:SubCategory" } });
      if (raw.color !== undefined) facts.push({ name: "Colour", ...fmtColor(raw.color as number) });
      if (raw.weight !== undefined) facts.push({ name: "Weight", value: String(raw.weight) });
      if (raw.style !== undefined) facts.push({ name: "Style", value: String(raw.style), reference: { id: String(raw.style), targetBaseClass: "BisCore:LineStyle" } });
      if (raw.transparency !== undefined) facts.push({ name: "Transparency", value: String(raw.transparency) });
      if (raw.displayPriority !== undefined) facts.push({ name: "Display priority", value: String(raw.displayPriority) });
      if (raw.geometryClass !== undefined) facts.push({ name: "Geometry class", value: geometryClassName(raw.geometryClass as GeometryClass) });
      const detail = facts.length === 0 ? "reset to sub-category" : facts.map((f) => `${f.name.toLowerCase()} ${f.value}`).join(", ");
      return { detail, facts };
    }
    case "subRange": {
      const r = Range3d.fromJSON(raw as { low: XYZProps; high: XYZProps });
      return { detail: fmtRangeSize(r), facts: [{ name: "Range", value: fmtRange(r) }, { name: "Size", value: fmtRangeSize(r) }] };
    }
    case "fill": {
      const facts: Fact[] = [{ name: "Display", value: FILL_DISPLAY_NAMES[raw.display as number] ?? String(raw.display) }];
      if (raw.color !== undefined) facts.push({ name: "Colour", ...fmtColor(raw.color as number) });
      if (raw.gradient !== undefined) facts.push({ name: "Gradient", value: "yes" });
      if (raw.backgroundFill !== undefined) facts.push({ name: "Background fill", value: String(raw.backgroundFill) });
      if (raw.transparency !== undefined) facts.push({ name: "Transparency", value: String(raw.transparency) });
      return { detail: facts.map((f) => `${f.name.toLowerCase()} ${f.value}`).join(", "), facts };
    }
    case "material":
      return { detail: raw.materialId ? String(raw.materialId) : "no material", facts: [{
        name: "Material", value: String(raw.materialId ?? "none"),
        reference: raw.materialId ? { id: String(raw.materialId), targetBaseClass: "BisCore:RenderMaterial" } : undefined,
      }] };
    case "styleMod":
    case "pattern": {
      const facts = Object.entries(raw)
        .filter(([, v]) => v !== undefined && typeof v !== "object")
        .map(([n, v]) => ({
          name: n, value: String(v),
          reference: key === "pattern" && n === "symbolId" ? { id: String(v), targetBaseClass: "BisCore:GeometryPart" } : undefined,
        }));
      return { detail: facts.map((f) => `${f.name} ${f.value}`).join(", "), facts };
    }
    default:
      return { detail: "", facts: [] };
  }
}

const OP_LABELS: Record<StreamOpKind, string> = {
  header: "Header", appearance: "Appearance", styleMod: "Line style", fill: "Fill", pattern: "Pattern",
  material: "Material", subRange: "Sub-range", partReference: "Part reference", textString: "Text",
  image: "Image", brep: "BRep", geometry: "Geometry", unknown: "Unknown",
};

// --- the parser --------------------------------------------------------------------------------

function makeIterator(stream: GeometryStreamProps, ctx: StreamContext): GeometryStreamIterator | undefined {
  try {
    if (ctx.kind === "part")
      return GeometryStreamIterator.fromGeometryPart({ geom: stream } as Parameters<typeof GeometryStreamIterator.fromGeometryPart>[0], ctx.params, ctx.transform);
    const el = { geom: stream, placement: ctx.placement, category: ctx.category };
    return ctx.kind === "element2d"
      ? GeometryStreamIterator.fromGeometricElement2d(el as Parameters<typeof GeometryStreamIterator.fromGeometricElement2d>[0])
      : GeometryStreamIterator.fromGeometricElement3d(el as Pick<GeometricElement3dProps, "geom" | "placement" | "category">);
  } catch {
    return undefined;
  }
}

/** True when the raw op and the iterator entry describe the same primitive. The iterator silently
 * skips entries it cannot parse, so raw ops must be matched by discriminator, not by position. */
function matches(key: string, raw: GeometryStreamEntryProps, entry: GeometryStreamIteratorEntry): boolean {
  switch (entry.primitive.type) {
    case "partReference": return key === "geomPart";
    case "textString": return key === "textString";
    case "brep": return key === "brep";
    case "image": return key === "image";
    case "geometryQuery":
      // Two different geometry ops both satisfy the discriminator; re-parse the raw entry to be
      // sure this one is parseable at all (the iterator skips the ones that are not).
      return GEOMETRY_KEYS.has(key) && IModelJson.Reader.parse(raw) !== undefined;
    default: return false;
  }
}

function primitiveOp(index: number, kind: StreamOpKind, key: string, raw: GeometryStreamEntryProps, entry: GeometryStreamIteratorEntry | undefined, baseline?: SubCategoryAppearance): StreamOp {
  const appearance = entry ? snapshotOf(entry.geomParams, baseline) : undefined;
  const common = { index, kind, isPrimitive: true, raw, appearance, localRange: entry?.localRange ? Range3d.fromJSON(entry.localRange.toJSON()) : undefined };

  if (kind === "partReference") {
    const gp = raw.geomPart!;
    const facts: Fact[] = [{ name: "Part", value: gp.part, reference: { id: gp.part, targetBaseClass: "BisCore:GeometryPart" } }];
    if (gp.origin !== undefined) facts.push({ name: "Origin", value: fmtPoint(gp.origin) });
    if (gp.rotation !== undefined) facts.push({ name: "Rotation", value: fmtAngles(YawPitchRollAngles.fromJSON(gp.rotation)) });
    if (gp.scale !== undefined) facts.push({ name: "Scale", value: num(gp.scale) });
    return {
      ...common, label: OP_LABELS[kind], detail: gp.part, partId: gp.part, facts,
      partParams: entry?.geomParams.clone(), partToWorld: entry?.localToWorld?.clone(),
    };
  }
  if (kind === "textString") {
    const ts = raw.textString as TextStringProps;
    const facts: Fact[] = [
      { name: "Text", value: ts.text },
      { name: "Font", value: String(ts.font) },
      { name: "Height", value: num(ts.height) },
    ];
    if (ts.widthFactor !== undefined) facts.push({ name: "Width factor", value: num(ts.widthFactor) });
    if (ts.origin !== undefined) facts.push({ name: "Origin", value: fmtPoint(ts.origin) });
    const styles = [ts.bold && "bold", ts.italic && "italic", ts.underline && "underline"].filter(Boolean).join(", ");
    if (styles) facts.push({ name: "Style", value: styles });
    return { ...common, label: OP_LABELS[kind], detail: `“${ts.text}”`, facts };
  }
  if (kind === "brep") {
    const b = raw.brep!;
    const type = BREP_TYPE_NAMES[b.type ?? BRepEntity.Type.Solid] ?? String(b.type);
    const facts: Fact[] = [
      { name: "Body type", value: type },
      { name: "Data", value: b.data !== undefined ? `${Math.round((b.data.length * 3) / 4 / 1024)} KB (base-64)` : "not fetched" },
    ];
    if (b.faceSymbology?.length) facts.push({ name: "Face symbology", value: `${b.faceSymbology.length} faces` });
    if (b.transform !== undefined) facts.push({ name: "Transform", value: fmtTransform(Transform.fromJSON(b.transform)).join(" ") });
    return { ...common, label: OP_LABELS[kind], detail: type, facts };
  }
  if (kind === "image")
    return { ...common, label: OP_LABELS[kind], detail: "image graphic", facts: [] };

  // geometry
  if (entry?.primitive.type === "geometryQuery") {
    const d = describeGeometry(entry.primitive.geometry);
    return { ...common, label: d.label, detail: d.detail, facts: d.facts, counts: d.counts, localRange: common.localRange ?? d.range };
  }
  return { ...common, label: `${OP_LABELS.geometry} (${key})`, detail: "could not be parsed", facts: [], notParsed: true };
}

/** Parses a raw geometry stream into ordered, formatted ops plus a summary. Walks the raw array so
 * every entry is shown, while advancing a GeometryStreamIterator alongside for resolved symbology;
 * primitives are reconciled by discriminator because the iterator skips entries it cannot parse. */
export function parseGeometryStream(stream: GeometryStreamProps, ctx: StreamContext, baseline?: SubCategoryAppearance): ParsedStream {
  const it = makeIterator(stream, ctx);
  const resolved: GeometryStreamIteratorEntry[] = [];
  if (it) {
    try {
      for (const entry of it)
        resolved.push({ geomParams: entry.geomParams.clone(), localToWorld: entry.localToWorld, localRange: entry.localRange?.clone(), primitive: entry.primitive });
    } catch { /* keep what was resolved before the failure */ }
  }

  const ops: StreamOp[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let pendingSubRange: Range3d | undefined;
  let points = 0, facets = 0, hasBRep = false;
  const viewIndependent = ((it?.flags ?? GeometryStreamFlags.None) & GeometryStreamFlags.ViewIndependent) !== 0;

  stream.forEach((raw, index) => {
    const { kind, key } = classifyOp(raw);
    if (!PRIMITIVE_KINDS.has(kind)) {
      const { detail, facts } = modifierFacts(key, raw);
      const op: StreamOp = { index, kind, label: kind === "unknown" ? `Unknown (${key})` : OP_LABELS[kind], detail, facts, isPrimitive: false, raw };
      if (kind === "subRange") pendingSubRange = Range3d.fromJSON((raw as { subRange: object }).subRange as Parameters<typeof Range3d.fromJSON>[0]);
      ops.push(op);
      return;
    }
    const entry = cursor < resolved.length && matches(key, raw, resolved[cursor]) ? resolved[cursor++] : undefined;
    let op = primitiveOp(index, kind, key, raw, entry, baseline);
    if (pendingSubRange) {
      op = { ...op, localRange: op.localRange ?? pendingSubRange };
      pendingSubRange = undefined;
    }
    if (op.partId && !parts.includes(op.partId)) parts.push(op.partId);
    points += op.counts?.points ?? 0;
    facets += op.counts?.facets ?? 0;
    if (kind === "brep") hasBRep = true;
    ops.push(op);
  });

  const byKind = new Map<StreamOpKind, number>();
  for (const op of ops) byKind.set(op.kind, (byKind.get(op.kind) ?? 0) + 1);
  const primitives = ops.filter((o) => o.isPrimitive).length;

  return {
    ops, parts,
    summary: { totalOps: ops.length, byKind, primitives, points, facets, distinctParts: parts.length, hasBRep, viewIndependent },
  };
}
