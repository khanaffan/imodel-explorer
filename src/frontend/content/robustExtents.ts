import { QueryRowFormat } from "@itwin/core-common";
import type { IModelConnection } from "@itwin/core-frontend";
import { Range3d } from "@itwin/core-geometry";

/** [minX, minY, minZ, maxX, maxY, maxZ] */
export type Box = readonly [number, number, number, number, number, number];

const SAMPLE_LIMIT = 20000;
const STRIDES = [1, 16, 256, 4096];

/**
 * Project extents are often blown up by a few stray elements (e.g. one at the origin while the
 * site sits at 440 km, 280 km), so fitting the view to them shows a black screen. This samples the
 * spatial index evenly and returns the range covering the central `1 - 2 * trim` of the geometry.
 */
export async function queryRobustExtents(imodel: IModelConnection, trim = 0.01): Promise<Range3d | undefined> {
  for (const stride of STRIDES) {
    const boxes: Box[] = [];
    const where = stride > 1 ? `WHERE ECInstanceId % ${stride} = 0` : "";
    const reader = imodel.createQueryReader(
      `SELECT MinX, MinY, MinZ, MaxX, MaxY, MaxZ FROM bis.SpatialIndex ${where} LIMIT ${SAMPLE_LIMIT}`,
      undefined, { rowFormat: QueryRowFormat.UseECSqlPropertyIndexes });
    for await (const row of reader)
      boxes.push([row[0], row[1], row[2], row[3], row[4], row[5]]);
    if (boxes.length < SAMPLE_LIMIT || stride === STRIDES[STRIDES.length - 1])
      return robustRange(boxes, trim);
  }
  return undefined;
}

/** Per axis, the `trim` quantile of box minimums to the `1 - trim` quantile of box maximums. */
export function robustRange(boxes: readonly Box[], trim = 0.01): Range3d | undefined {
  const valid = boxes.filter((b) => b.every(Number.isFinite) && b[0] <= b[3] && b[1] <= b[4] && b[2] <= b[5]);
  if (valid.length === 0) return undefined;
  const lo = [0, 1, 2].map((a) => quantile(valid.map((b) => b[a]), trim));
  const hi = [3, 4, 5].map((a) => quantile(valid.map((b) => b[a]), 1 - trim));
  const range = Range3d.createXYZXYZ(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
  return range.isNull ? undefined : range;
}

function quantile(values: number[], q: number): number {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
}

/** Use the robust range only when it is much tighter than the project extents. */
export function shouldRefit(project: Range3d, robust: Range3d | undefined): robust is Range3d {
  if (!robust || project.isNull) return false;
  return robust.diagonal().magnitude() < 0.5 * project.diagonal().magnitude();
}
