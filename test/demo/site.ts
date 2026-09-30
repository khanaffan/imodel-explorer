import type { DemoContext } from "../demoModel";
import { Shape } from "./builder";

const ASSEMBLY = "BisCore:PhysicalElementAssemblesElements";

/** Deterministic PRNG so the generated model is identical on every run. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function buildSite(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const site = models.site;
  const civil = cats.civil;
  const feature = (label: string, kind: string, shape: Shape) =>
    w.physical("WaterPlant:SiteFeature", site, civil, label, shape, { featureKind: kind });

  feature("Site grading", "Grass", new Shape(civil.id, [0, 0, -0.05]).sub(civil.subs.Ground).box(-90, -60, -0.35, 90, 60, -0.05));
  feature("Process slab", "Hardstanding", new Shape(civil.id, [2, 0.5, 0]).sub(civil.subs.Concrete).box(-64, -35, -0.3, 68, 36, 0));

  const road = new Shape(civil.id, [0, -42.5, 0]).sub(civil.subs.Paving).box(-90, -46, -0.3, 90, -39, -0.02);
  road.sub(civil.subs.Markings);
  for (let x = -88; x < 88; x += 6)
    road.box(x, -42.65, -0.02, x + 3, -42.35, -0.01);
  road.box(-90, -45.7, -0.02, 90, -45.55, -0.01).box(-90, -39.45, -0.02, 90, -39.3, -0.01);
  feature("Riverbend Road", "Road", road);
  feature("Site entrance", "Driveway", new Shape(civil.id, [-37, -37, 0]).sub(civil.subs.Paving).box(-41, -39, -0.3, -33, -35, -0.01));

  buildFence(ctx);
  buildTrees(ctx);
  buildControlBuilding(ctx);
}

function buildFence(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const f = cats.fencing;
  const [x0, x1, y0, y1, h] = [-66, 70, -37, 38, 2.2];
  const fence = new Shape(f.id, [x0, y0, 0]);
  const side = (a: [number, number], b: [number, number], skip?: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 4);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (skip && x > skip[0] && x < skip[1])
        continue;
      fence.sub(f.subs.Posts).cyl([x, y, 0], [x, y, h], 0.05);
    }
    const panels: Array<[number, number]> = skip ? [[a[0], skip[0]], [skip[1], b[0]]] : [[a[0], b[0]]];
    fence.sub(f.subs.Mesh);
    for (const [pa, pb] of panels) {
      if (a[1] === b[1])
        fence.box(Math.min(pa, pb), a[1] - 0.01, 0.05, Math.max(pa, pb), a[1] + 0.01, h);
      else
        fence.box(a[0] - 0.01, Math.min(a[1], b[1]), 0.05, a[0] + 0.01, Math.max(a[1], b[1]), h);
    }
  };
  side([x0, y0], [x1, y0], [-41, -33]);
  side([x1, y0], [x1, y1]);
  side([x0, y1], [x1, y1]);
  side([x0, y0], [x0, y1]);
  w.physical("WaterPlant:SiteFeature", models.site, f, "Perimeter fence", fence, { featureKind: "Fence" });

  const gate = new Shape(f.id, [-37, -37, 0]).sub(f.subs.Posts)
    .cyl([-41, -37, 0], [-41, -37, 2.6], 0.12).cyl([-33, -37, 0], [-33, -37, 2.6], 0.12)
    .box(-41, -37.05, 2.1, -37.5, -36.95, 2.2).box(-41, -37.05, 0.2, -37.5, -36.95, 0.3);
  gate.sub(f.subs.Mesh).box(-41, -37.02, 0.3, -37.5, -36.98, 2.1);
  w.physical("WaterPlant:SiteFeature", models.site, f, "Main gate", gate, { featureKind: "Gate" });
}

function buildTrees(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const l = cats.landscape;
  const belts: Array<[string, number, number, number, number, number]> = [
    ["North tree belt", -80, 80, 44, 56, 18],
    ["West tree belt", -86, -72, -32, 40, 10],
    ["East tree belt", 76, 86, -32, 40, 10],
  ];
  const rnd = random(42);
  for (const [label, xa, xb, ya, yb, n] of belts) {
    const belt = new Shape(l.id, [(xa + xb) / 2, (ya + yb) / 2, 0]);
    const alongX = xb - xa > yb - ya;
    for (let i = 0; i < n; i++) {
      // Evenly spaced along the belt with jitter; random across it.
      const along = (i + 0.1 + rnd() * 0.8) / n;
      const across = rnd();
      const x = xa + (xb - xa) * (alongX ? along : across);
      const y = ya + (yb - ya) * (alongX ? across : along);
      const size = 0.8 + rnd() * 0.5;
      belt.sub(l.subs.Trunk).cyl([x, y, -0.05], [x, y, 2.4 * size], 0.22 * size);
      belt.sub(l.subs.Foliage);
      if (rnd() < 0.45)
        belt.cone([x, y, 1.6 * size], [x, y, 8 * size], 2.2 * size, 0.05);
      else
        belt.sphere([x, y, 3.8 * size], 2.4 * size);
    }
    w.physical("WaterPlant:SiteFeature", models.site, l, label, belt, { featureKind: "Planting" });
  }
}

function buildControlBuilding(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const b = cats.buildings;
  const [x0, y0, x1, y1, h, t] = [-58, -34, -42, -22, 4.5, 0.3];
  const building = w.physical("WaterPlant:Building", models.site, b, "Control building",
    new Shape(b.id, [(x0 + x1) / 2, (y0 + y1) / 2, 0]).sub(b.subs.Walls).box(x0 - 0.3, y0 - 0.3, 0, x1 + 0.3, y1 + 0.3, 0.2),
    { use: "Operations & MCC room", floorArea: (x1 - x0) * (y1 - y0) });
  const part = (label: string, kind: string, material: string, shape: Shape) =>
    w.physical("WaterPlant:BuildingComponent", models.site, b, label, shape,
      { componentKind: kind, material, parent: { id: building, relClassName: ASSEMBLY } });
  const shape = (sub: string, origin: [number, number, number]) => new Shape(b.id, origin).sub(b.subs[sub]);

  part("CB South wall", "Wall", "Blockwork", shape("Walls", [(x0 + x1) / 2, y0, 0]).box(x0, y0, 0.2, x1, y0 + t, h));
  part("CB North wall", "Wall", "Blockwork", shape("Walls", [(x0 + x1) / 2, y1, 0]).box(x0, y1 - t, 0.2, x1, y1, h));
  part("CB West wall", "Wall", "Blockwork", shape("Walls", [x0, (y0 + y1) / 2, 0]).box(x0, y0, 0.2, x0 + t, y1, h));
  part("CB East wall", "Wall", "Blockwork", shape("Walls", [x1, (y0 + y1) / 2, 0]).box(x1 - t, y0, 0.2, x1, y1, h));
  part("CB Roof", "Roof", "Standing-seam steel", shape("Roof", [(x0 + x1) / 2, (y0 + y1) / 2, h])
    .box(x0 - 0.6, y0 - 0.6, h, x1 + 0.6, y1 + 0.6, h + 0.35).box(x0 + 3, y0 + 3, h + 0.35, x0 + 5, y0 + 4.5, h + 1.2));
  part("CB Main door", "Door", "Timber", shape("Doors", [-53, y0, 0]).box(-54.2, y0 - 0.08, 0.2, -51.8, y0 + 0.02, 2.5));
  part("CB Roller shutter", "Door", "Steel", shape("Doors", [x1, -28, 0]).box(x1 - 0.02, -30, 0.2, x1 + 0.08, -26, 3.6));
  for (const [i, x] of [-49.5, -46.5].entries())
    part(`CB Window S${i + 1}`, "Window", "Double glazing", shape("Glazing", [x, y0, 1.8]).box(x - 1, y0 - 0.06, 1.1, x + 1, y0 + 0.02, 2.6));
  for (const [i, x] of [-55, -50, -45].entries())
    part(`CB Window N${i + 1}`, "Window", "Double glazing", shape("Glazing", [x, y1, 1.8]).box(x - 1, y1 - 0.02, 1.1, x + 1, y1 + 0.06, 2.6));
  part("CB Canopy", "Canopy", "Steel", shape("Roof", [-53, y0 - 1, 3]).box(-55, y0 - 1.8, 2.9, -51, y0, 3.05));
}
