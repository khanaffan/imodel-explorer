/** Squarified treemap layout (Bruls, Huizing & van Wijk). Pure — no DOM. */

export interface TreemapItem {
  readonly key: string;
  readonly value: number;
}

export interface TreemapRect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Lays `items` out in the box `(x, y, width, height)`, giving each item an area proportional to
 * its value and keeping the rectangles close to square. Items with value <= 0 are skipped. */
export function layoutTreemap(items: readonly TreemapItem[], x: number, y: number, width: number, height: number): TreemapRect[] {
  const positive = items.filter((i) => i.value > 0);
  if (positive.length === 0 || width <= 0 || height <= 0)
    return [];
  const total = positive.reduce((s, i) => s + i.value, 0);
  const scale = (width * height) / total;
  // Areas, largest first — the squarify invariant requires descending order.
  const areas = positive
    .map((i) => ({ key: i.key, area: i.value * scale }))
    .sort((a, b) => b.area - a.area);

  const rects: TreemapRect[] = [];
  let bx = x, by = y, bw = width, bh = height;
  let row: typeof areas = [];

  const worst = (candidates: typeof areas, side: number): number => {
    const sum = candidates.reduce((s, c) => s + c.area, 0);
    let max = 0, min = Infinity;
    for (const c of candidates) {
      if (c.area > max) max = c.area;
      if (c.area < min) min = c.area;
    }
    const s2 = sum * sum;
    const w2 = side * side;
    return Math.max((w2 * max) / s2, s2 / (w2 * min));
  };

  const layoutRow = (candidates: typeof areas) => {
    const sum = candidates.reduce((s, c) => s + c.area, 0);
    const horizontal = bw < bh; // the row runs along the shorter side
    const thickness = sum / (horizontal ? bw : bh);
    let offset = 0;
    for (const c of candidates) {
      const length = c.area / thickness;
      rects.push(horizontal
        ? { key: c.key, x: bx + offset, y: by, width: length, height: thickness }
        : { key: c.key, x: bx, y: by + offset, width: thickness, height: length });
      offset += length;
    }
    if (horizontal) {
      by += thickness;
      bh -= thickness;
    } else {
      bx += thickness;
      bw -= thickness;
    }
  };

  for (const item of areas) {
    const side = Math.min(bw, bh);
    if (row.length > 0 && worst([...row, item], side) > worst(row, side)) {
      layoutRow(row);
      row = [item];
    } else {
      row.push(item);
    }
  }
  if (row.length > 0)
    layoutRow(row);
  return rects;
}
