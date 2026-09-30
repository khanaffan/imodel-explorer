import type { DemoContext } from "../demoModel";
import { Shape, type XYZ } from "./builder";
import { Criticality, Service, TYPE_REL } from "./process";

type Axis = "x" | "y" | "z";
const SERVICE_SUB = ["RawWater", "Settled", "Filtered", "Treated", "Chemical", "Sludge"];

/** X on a circular tank wall at row `y`, nudged 0.1 m inside so the pipe visibly enters it. */
function wallX(cx: number, cy: number, r: number, y: number, side: 1 | -1): number {
  return cx + side * (Math.sqrt(r * r - (y - cy) ** 2) - 0.1);
}
function wallY(cx: number, cy: number, r: number, x: number, side: 1 | -1): number {
  return cy + side * (Math.sqrt(r * r - (x - cx) ** 2) - 0.1);
}
const radius = (dn: number) => Math.max(0.05, dn / 1000 * 0.6);

interface PipeDef { tag: string; service: number; dn: number; from?: string; to?: string; pts: XYZ[] }

export function buildPiping(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const pc = cats.piping;

  const header = (label: string, a: XYZ, b: XYZ, description: string) =>
    w.physical("WaterPlant:Header", models.piping, pc, label,
      new Shape(pc.id, a).sub(pc.subs.Treated).cyl(a, b, 0.3).sphere(a, 0.3).sphere(b, 0.3), { tag: label, description });
  header("H-400", [38, -3, 0.9], [54, -3, 0.9], "High-lift suction manifold");
  header("H-601", [62, -30, 1.2], [62, 20, 1.2], "Treated water distribution header");

  const pipes: PipeDef[] = [
    { tag: "RW-100", service: Service.RawWater, dn: 400, to: "T-001", pts: [[-74, 12, 0.9], [wallX(-52, 12, 6, 12, -1), 12, 0.9]] },
  ];
  for (const [sfx, y, cl, cy] of [["A", 16, "CL-201", 15], ["B", 8, "CL-202", -15]] as const) {
    const ny = y === 16 ? 14 : 10;
    pipes.push({ tag: `RW-101${sfx}`, service: Service.RawWater, dn: 300, from: "T-001", to: `P-101${sfx}`,
      pts: [[wallX(-52, 12, 6, ny, 1), ny, 0.9], [-43, ny, 0.9], [-43, y, 0.9], [-40.9, y, 0.9]] });
    pipes.push({ tag: `RW-102${sfx}`, service: Service.RawWater, dn: 250, from: `P-101${sfx}`, to: cl,
      pts: [[-40, y, 1.5], [-40, y, 3], [-30, y, 3], [-30, cy, 3], [wallX(-12, cy, 9, cy, -1), cy, 3]] });
  }
  pipes.push(
    { tag: "CH-100", service: Service.Chemical, dn: 25, from: "CT-01", to: "DP-01", pts: [[-36, 26.5, 0.4], [-36, 23, 0.4]] },
    { tag: "CH-101", service: Service.Chemical, dn: 25, from: "DP-01", to: "CL-201",
      pts: [[-35, 22.5, 1], [-26, 22.5, 1], [-26, 18, 1], [wallX(-12, 15, 9, 18, -1), 18, 1]] },
    { tag: "CH-400", service: Service.Chemical, dn: 25, from: "CT-02", to: "DP-02", pts: [[30, 26.5, 0.4], [30, 23, 0.4]] },
    { tag: "CH-401", service: Service.Chemical, dn: 25, from: "DP-02", to: "T-401",
      pts: [[31, 22.5, 1], [33, 22.5, 1], [33, wallY(35, 10, 8, 33, 1), 1]] },
  );
  for (const [tag, cl, cy, ys, fy] of [
    ["SW-201", "CL-201", 15, 16, 16], ["SW-202", "CL-201", 15, 13, 7],
    ["SW-203", "CL-202", -15, -13, -7], ["SW-204", "CL-202", -15, -16, -16],
  ] as const) {
    const start: XYZ = [wallX(-12, cy, 9, ys, 1), ys, 2.5];
    const pts: XYZ[] = ys === fy ? [start, [8, fy, 2.5]] : [start, [2, ys, 2.5], [2, fy, 2.5], [8, fy, 2.5]];
    pipes.push({ tag, service: Service.Settled, dn: 300, from: cl, to: `F-30${tag.slice(-1)}`, pts });
  }
  for (const [i, [fy, xTurn, ty]] of ([[16, 20, 12], [7, 21, 10], [-7, 22, 8], [-16, 23, 6]] as const).entries()) {
    pipes.push({ tag: `FW-30${i + 1}`, service: Service.Filtered, dn: 300, from: `F-30${i + 1}`, to: "T-401",
      pts: [[16, fy, 0.9], [xTurn, fy, 0.9], [xTurn, ty, 0.9], [wallX(35, 10, 8, ty, -1), ty, 0.9]] });
  }
  pipes.push({ tag: "TW-400", service: Service.Treated, dn: 500, from: "T-401", to: "H-400",
    pts: [[35, wallY(35, 10, 8, 35, -1), 0.9], [35, -3, 0.9], [37.7, -3, 0.9]] });
  for (const [sfx, x, yk, zk] of [["A", 40, -9, 3.2], ["B", 46, -10.5, 2.6], ["C", 52, -12, 2]] as const) {
    pipes.push({ tag: `TW-411${sfx}`, service: Service.Treated, dn: 300, from: "H-400", to: `P-501${sfx}`,
      pts: [[x - 1.6, -3.25, 0.9], [x - 1.6, -6, 0.9], [x - 0.9, -6, 0.9]] });
    pipes.push({ tag: `TW-501${sfx}`, service: Service.Treated, dn: 250, from: `P-501${sfx}`, to: "H-601",
      pts: [[x, -6, 1.5], [x, -6, zk], [x, yk, zk], [60, yk, zk], [60, yk, 1.2], [61.7, yk, 1.2]] });
  }
  for (const [tag, pts] of [
    ["SL-201", [[-12, wallY(-12, 15, 9, -12, -1), 0.5], [-12, 1, 0.5], [-24, 1, 0.5], [-24, -31, 0.5], [wallX(-12, -31, 3, -31, -1), -31, 0.5]]],
    ["SL-202", [[-12, wallY(-12, -15, 9, -12, -1), 0.5], [-12, wallY(-12, -31, 3, -12, 1), 0.5]]],
  ] as const)
    pipes.push({ tag, service: Service.Sludge, dn: 150, from: `CL-20${tag.slice(-1)}`, to: "T-701", pts: pts.map((p) => [...p] as XYZ) });
  for (let i = 0; i < 30; i++) {
    const y = -28 + 1.6 * i;
    pipes.push({ tag: `SC-${String(i + 1).padStart(2, "0")}`, service: Service.Treated, dn: 150, from: "H-601",
      pts: [[62.3, y, 1.2], [69.2, y, 1.2], [69.2, y, -0.8]] });
  }

  const pipeRadius = new Map<string, number>([["H-601", 0.3]]);
  for (const p of pipes) {
    const r = radius(p.dn);
    pipeRadius.set(p.tag, r);
    const s = new Shape(pc.id, p.pts[0]).sub(pc.subs[SERVICE_SUB[p.service]]).run(p.pts, r);
    addSupports(s, p.pts, pc.subs.Supports);
    let length = 0;
    for (let i = 1; i < p.pts.length; i++)
      length += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1], p.pts[i][2] - p.pts[i - 1][2]);
    w.physical("WaterPlant:Pipe", models.piping, pc, p.tag, s, {
      tag: p.tag, service: p.service, nominalDiameter: p.dn, length: Math.round(length * 10) / 10,
      fromEquipment: p.from ? { id: w.id(p.from), relClassName: "WaterPlant:PipeRunsFromEquipment" } : undefined,
      toEquipment: p.to ? { id: w.id(p.to), relClassName: "WaterPlant:PipeRunsToEquipment" } : undefined,
    });
  }

  buildValves(ctx, pipeRadius);
  buildInstruments(ctx, pipeRadius);
}

/** Steel T-posts every ~6 m under elevated horizontal runs. */
function addSupports(s: Shape, pts: XYZ[], sub: string): void {
  s.sub(sub);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (a[2] < 2 || a[2] !== b[2])
      continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 3; d < len - 1; d += 6) {
      const [x, y] = [a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len];
      s.box(x - 0.08, y - 0.08, 0, x + 0.08, y + 0.08, a[2] - 0.25).box(x - 0.4, y - 0.4, a[2] - 0.35, x + 0.4, y + 0.4, a[2] - 0.25);
    }
  }
}

const unit: Record<Axis, XYZ> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const along = (p: XYZ, axis: Axis, d: number): XYZ => [p[0] + unit[axis][0] * d, p[1] + unit[axis][1] * d, p[2] + unit[axis][2] * d];

function buildValves(ctx: DemoContext, pipeRadius: Map<string, number>): void {
  const { w, models, cats } = ctx;
  const v = cats.valves;
  const valve = (label: string, pipe: string, pos: XYZ, axis: Axis, type: string, normallyOpen = true) => {
    const r = pipeRadius.get(pipe)!;
    const s = new Shape(v.id, pos).sub(v.subs.Body).sphere(pos, r * 1.7)
      .cyl(along(pos, axis, -0.35), along(pos, axis, -0.28), r * 2.1).cyl(along(pos, axis, 0.28), along(pos, axis, 0.35), r * 2.1);
    const stem: Axis = axis === "z" ? "x" : "z";
    const top = along(pos, stem, r * 1.7 + 0.45);
    s.cyl(pos, top, 0.035).sub(v.subs.Handwheel).cyl(top, along(top, stem, 0.05), 0.28);
    w.physical("WaterPlant:Valve", models.piping, v, label, s, {
      tag: label, description: `${type} on ${pipe}`, normallyOpen, criticality: type.startsWith("Check") ? Criticality.Medium : Criticality.Low,
      maintenanceIntervalDays: 365, installedOn: { id: w.id(pipe), relClassName: "WaterPlant:PipeHasInlineValves" },
      typeDefinition: { id: w.id(type), relClassName: TYPE_REL },
    });
  };
  for (const [sfx, y] of [["A", 16], ["B", 8]] as const) {
    valve(`V-101${sfx}`, `RW-101${sfx}`, [-42, y, 0.9], "x", "Butterfly DN300");
    valve(`V-102${sfx}`, `RW-102${sfx}`, [-40, y, 2.2], "z", "Check DN200");
    valve(`V-103${sfx}`, `RW-102${sfx}`, [-37, y, 3], "x", "Gate DN200");
  }
  valve("V-201", "RW-102A", [-24, 15, 3], "x", "Butterfly DN300");
  valve("V-202", "RW-102B", [-24, -15, 3], "x", "Butterfly DN300", false);
  for (const [i, y] of [16, 7, -7, -16].entries())
    valve(`V-30${i + 1}`, `FW-30${i + 1}`, [18, y, 0.9], "x", "Butterfly DN300");
  valve("V-400", "TW-400", [35, 0, 0.9], "y", "Butterfly DN300");
  for (const [sfx, x, zk] of [["A", 40, 3.2], ["B", 46, 2.6], ["C", 52, 2]] as const)
    valve(`V-501${sfx}`, `TW-501${sfx}`, [x, -7.4, zk], "y", "Check DN200");
  valve("V-701", "SL-201", [-24, -10, 0.5], "y", "Gate DN200", false);
  valve("V-702", "SL-202", [-12, -26, 0.5], "y", "Gate DN200", false);
}

function buildInstruments(ctx: DemoContext, pipeRadius: Map<string, number>): void {
  const { w, models, cats } = ctx;
  const ic = cats.instruments;
  const common = (label: string, variable: string, rangeMax: number, units: string) =>
    ({ tag: label, description: `${variable} transmitter`, measuredVariable: variable, rangeMax, units });
  const flow = (label: string, pipe: string, pos: XYZ, axis: Axis, rangeMax: number, alarmHigh: number, target = pipe) => {
    const r = pipeRadius.get(pipe)!;
    const s = new Shape(ic.id, pos).sub(ic.subs.Body).cyl(along(pos, axis, -0.35), along(pos, axis, 0.35), r * 1.35)
      .cyl(pos, [pos[0], pos[1], pos[2] + r * 1.35 + 0.25], 0.04)
      .box(pos[0] - 0.15, pos[1] - 0.15, pos[2] + r * 1.35 + 0.25, pos[0] + 0.15, pos[1] + 0.15, pos[2] + r * 1.35 + 0.55);
    w.physical("WaterPlant:FlowMeter", models.piping, ic, label, s, common(label, "Flow", rangeMax, "L/s"));
    w.link("WaterPlant:InstrumentMonitors", label, target, { alarmHigh });
  };
  const level = (label: string, target: string, pos: XYZ, rangeMax: number) => {
    const s = new Shape(ic.id, pos).sub(ic.subs.Body).cyl(pos, [pos[0], pos[1], pos[2] + 0.4], 0.06)
      .box(pos[0] - 0.18, pos[1] - 0.18, pos[2] + 0.4, pos[0] + 0.18, pos[1] + 0.18, pos[2] + 0.75);
    w.physical("WaterPlant:LevelTransmitter", models.process, ic, label, s, common(label, "Level", rangeMax, "m"));
    w.link("WaterPlant:InstrumentMonitors", label, target, { alarmHigh: rangeMax * 0.9 });
  };
  flow("FIT-101", "RW-100", [-64, 12, 0.9], "x", 200, 180);
  flow("FIT-201", "SW-201", [0, 16, 2.5], "x", 150, 120);
  flow("FIT-204", "SW-204", [0, -16, 2.5], "x", 150, 120);
  flow("FIT-601", "H-601", [62, -25, 1.2], "y", 500, 450);
  level("LT-001", "T-001", [-52, 16.5, 7.3], 7);
  level("LT-201", "CL-201", [-12, 15, 5.9], 4);
  level("LT-202", "CL-202", [-12, -15, 5.9], 4);
  level("LT-401", "T-401", [35, 14, 7.2], 6);
  level("LT-701", "T-701", [-12, -31, 4.7], 4);
  level("LT-011", "CT-01", [-36, 28, 3.6], 3.2);
}
