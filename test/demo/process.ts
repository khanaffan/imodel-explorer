import type { DemoContext } from "../demoModel";
import { Shape } from "./builder";
import { buildPiping } from "./piping";

export const Criticality = { Low: 1, Medium: 2, High: 3 } as const;
export const Service = { RawWater: 0, Settled: 1, Filtered: 2, Treated: 3, Chemical: 4, Sludge: 5 } as const;
export const TYPE_REL = "BisCore:PhysicalElementIsOfType";

export function buildProcess(ctx: DemoContext): void {
  buildTanks(ctx);
  buildPumps(ctx);
  buildElectrical(ctx);
  buildPiping(ctx);
  linkProcess(ctx);
}

function buildTanks(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const t = cats.tanks;
  const tank = (cls: string, label: string, [cx, cy]: [number, number], r: number, h: number, description: string, roof: "cone" | "open") => {
    const s = new Shape(t.id, [cx, cy, 0]).sub(t.subs.Concrete).cyl([cx, cy, -0.2], [cx, cy, 0.3], r + 0.4);
    if (roof === "cone") {
      s.sub(t.subs.Shell).cyl([cx, cy, 0.3], [cx, cy, h], r);
      s.sub(t.subs.Roof).cone([cx, cy, h], [cx, cy, h + r * 0.22], r + 0.15, 0.4);
      if (r >= 2.5) {
        // Access ladder and roof handrail (posts joined by a top rail).
        s.sub(t.subs.Steelwork).box(cx - 0.3, cy - r - 0.3, 0.3, cx + 0.3, cy - r - 0.25, h + 1.1);
        const rail = (a: number): [number, number, number] =>
          [cx + (r - 0.3) * Math.cos(a * Math.PI / 180), cy + (r - 0.3) * Math.sin(a * Math.PI / 180), h + 1.1];
        for (let a = 0; a < 360; a += 30) {
          const top = rail(a);
          s.cyl([top[0], top[1], h + 0.05], top, 0.03).cyl(top, rail(a + 30), 0.03);
        }
      }
    } else {
      s.sub(t.subs.Concrete).cyl([cx, cy, 0.3], [cx, cy, h], r);
      s.sub(t.subs.Water).disk([cx, cy, h + 0.02], r - 0.35);
      // Rotating bridge with centre column and drive.
      s.sub(t.subs.Steelwork)
        .cyl([cx, cy, h], [cx, cy, h + 0.9], 0.6)
        .box(cx, cy - 0.6, h + 0.6, cx + r + 0.2, cy + 0.6, h + 0.8)
        .box(cx, cy - 0.65, h + 0.8, cx + r + 0.2, cy - 0.6, h + 1.8)
        .box(cx, cy + 0.6, h + 0.8, cx + r + 0.2, cy + 0.65, h + 1.8)
        .box(cx - 0.8, cy - 0.8, h + 0.9, cx + 0.8, cy + 0.8, h + 1.9);
    }
    return w.physical(`WaterPlant:${cls}`, models.process, t, label, s, {
      tag: label, description, capacity: Math.round(Math.PI * r * r * h), diameter: 2 * r, height: h,
    });
  };
  tank("Tank", "T-001", [-52, 12], 6, 7, "Raw water balancing tank", "cone");
  tank("Clarifier", "CL-201", [-12, 15], 9, 4, "Clarifier No.1", "open");
  tank("Clarifier", "CL-202", [-12, -15], 9, 4, "Clarifier No.2", "open");
  tank("Tank", "T-401", [35, 10], 8, 6, "Treated water clearwell", "cone");
  tank("Tank", "T-701", [-12, -31], 3, 4, "Sludge holding tank", "cone");
  tank("Tank", "CT-01", [-36, 28], 1.6, 3.2, "Aluminium sulphate storage", "cone");
  tank("Tank", "CT-02", [30, 28], 1.6, 3.2, "Sodium hypochlorite storage", "cone");

  for (const [i, y] of [16, 7, -7, -16].entries()) {
    const s = new Shape(t.id, [12, y, 0]).sub(t.subs.Concrete)
      .box(8, y - 3.5, 0, 16, y - 3.2, 3.5).box(8, y + 3.2, 0, 16, y + 3.5, 3.5)
      .box(8, y - 3.5, 0, 8.3, y + 3.5, 3.5).box(15.7, y - 3.5, 0, 16, y + 3.5, 3.5)
      .box(8.3, y - 3.2, 0, 15.7, y + 3.2, 1.2);
    s.sub(t.subs.Water).box(8.3, y - 3.2, 1.2, 15.7, y + 3.2, 3.1);
    s.sub(t.subs.Steelwork).box(16, y - 3.5, 3.4, 17.4, y + 3.5, 3.5);
    s.box(17.35, y - 3.5, 3.5, 17.4, y + 3.5, 4.5);
    w.physical("WaterPlant:FilterBasin", models.process, t, `F-30${i + 1}`, s, {
      tag: `F-30${i + 1}`, description: `Rapid gravity filter ${i + 1}`, mediaType: "Dual media (anthracite/sand)", area: 47.4,
      criticality: Criticality.High, maintenanceIntervalDays: 180,
    });
  }
}

function buildPumps(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const p = cats.pumps;
  const m = cats.motors;
  const pump = (label: string, x: number, y: number, type: string, flow: number, head: number, description: string) => {
    const s = new Shape(p.id, [x, y, 0]).sub(p.subs.Base).box(x - 1.3, y - 0.55, 0, x + 2.4, y + 0.55, 0.3);
    s.sub(p.subs.Casing).sphere([x, y, 0.9], 0.55).cyl([x - 0.9, y, 0.9], [x, y, 0.9], 0.22)
      .cyl([x, y, 0.9], [x, y, 1.5], 0.2).cyl([x - 0.25, y, 0.35], [x + 0.25, y, 0.35], 0.3);
    w.physical("WaterPlant:Pump", models.process, p, label, s, {
      tag: label, description, dutyPoint: { flow, head }, criticality: Criticality.High, maintenanceIntervalDays: 90,
      typeDefinition: { id: w.id(type), relClassName: TYPE_REL },
    });
  };
  const motor = (label: string, x: number, y: number, kw: number) => {
    const s = new Shape(m.id, [x + 1.4, y, 0.9]).sub(m.subs.Body)
      .cyl([x + 0.65, y, 0.9], [x + 0.8, y, 0.9], 0.08)
      .cyl([x + 0.8, y, 0.9], [x + 2.0, y, 0.9], 0.45)
      .cone([x + 2.0, y, 0.9], [x + 2.3, y, 0.9], 0.45, 0.3)
      .box(x + 0.9, y - 0.4, 0.3, x + 1.9, y + 0.4, 0.5)
      .box(x + 1.2, y - 0.2, 1.3, x + 1.6, y + 0.2, 1.5);
    w.physical("WaterPlant:Motor", models.process, m, label, s, {
      tag: label, description: `${kw} kW induction motor`, powerKw: kw, voltage: 400, criticality: Criticality.Medium, maintenanceIntervalDays: 365,
    });
  };
  for (const [sfx, y] of [["A", 16], ["B", 8]] as const) {
    pump(`P-101${sfx}`, -40, y, "End-suction 80 L/s", 80, 18, "Raw water lift pump");
    motor(`M-101${sfx}`, -40, y, 30);
  }
  for (const [sfx, x] of [["A", 40], ["B", 46], ["C", 52]] as const) {
    pump(`P-501${sfx}`, x, -6, "Split-case 150 L/s", 150, 55, "High-lift treated water pump");
    motor(`M-501${sfx}`, x, -6, 55);
  }
  for (const [label, x, service] of [["DP-01", -36, "Coagulant"], ["DP-02", 30, "Disinfectant"]] as const) {
    const s = new Shape(p.id, [x, 22.5, 0]).sub(p.subs.Base).box(x - 1.2, 21.8, 0, x + 1.2, 23.2, 0.2)
      .sub(p.subs.Casing).cyl([x - 0.5, 22.5, 0.2], [x - 0.5, 22.5, 0.8], 0.25).cyl([x + 0.5, 22.5, 0.2], [x + 0.5, 22.5, 0.8], 0.25)
      .box(x - 1, 22.2, 0.8, x + 1, 22.8, 1.2);
    w.physical("WaterPlant:Pump", models.process, p, label, s, {
      tag: label, description: `${service} dosing pump`, dutyPoint: { flow: 0.03, head: 30 }, criticality: Criticality.High, maintenanceIntervalDays: 60,
      typeDefinition: { id: w.id("Diaphragm dosing"), relClassName: TYPE_REL },
    });
  }
}

function buildElectrical(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const e = cats.electrical;
  for (const [label, y, voltage, description] of [
    ["MCC-1", -31, 400, "Raw water & chemical MCC"],
    ["MCC-2", -28.5, 400, "High-lift pumping MCC"],
    ["PLC-1", -26, 24, "Plant control system"],
  ] as const) {
    const s = new Shape(e.id, [-39, y, 0]).sub(e.subs.Panel)
      .box(-39.8, y - 1, 0, -38.2, y + 1, 0.2).box(-39.5, y - 0.95, 0.2, -38.9, y + 0.95, 2.3);
    w.physical("WaterPlant:ControlPanel", models.electrical, e, label, s, { tag: label, description, voltage });
  }
}

function linkProcess(ctx: DemoContext): void {
  const { w } = ctx;
  const feeds = (from: string, to: string, service: number) => w.link("WaterPlant:ProcessFeeds", from, to, { service });
  for (const p of ["P-101A", "P-101B"]) {
    feeds("T-001", p, Service.RawWater);
    feeds(p, p === "P-101A" ? "CL-201" : "CL-202", Service.RawWater);
  }
  feeds("CT-01", "DP-01", Service.Chemical);
  feeds("DP-01", "CL-201", Service.Chemical);
  feeds("DP-01", "CL-202", Service.Chemical);
  for (const [cl, filters] of [["CL-201", ["F-301", "F-302"]], ["CL-202", ["F-303", "F-304"]]] as const) {
    for (const f of filters) {
      feeds(cl, f, Service.Settled);
      feeds(f, "T-401", Service.Filtered);
    }
    feeds(cl, "T-701", Service.Sludge);
  }
  feeds("CT-02", "DP-02", Service.Chemical);
  feeds("DP-02", "T-401", Service.Chemical);
  feeds("T-401", "H-400", Service.Treated);
  for (const sfx of ["A", "B", "C"]) {
    feeds("H-400", `P-501${sfx}`, Service.Treated);
    feeds(`P-501${sfx}`, "H-601", Service.Treated);
  }
  for (const sfx of ["A", "B"])
    w.link("WaterPlant:MotorDrivesPump", `M-101${sfx}`, `P-101${sfx}`, { coupling: "Flexible" });
  for (const sfx of ["A", "B", "C"])
    w.link("WaterPlant:MotorDrivesPump", `M-501${sfx}`, `P-501${sfx}`, { coupling: "Spacer" });

  const powers = (panel: string, targets: string[]) =>
    targets.forEach((t, i) => w.link("WaterPlant:PanelPowersEquipment", panel, t, { circuit: `${panel}/${String(i + 1).padStart(2, "0")}` }));
  powers("MCC-1", ["M-101A", "M-101B", "DP-01", "CL-201", "CL-202"]);
  powers("MCC-2", ["M-501A", "M-501B", "M-501C", "DP-02"]);
  powers("PLC-1", ["LT-001", "FIT-101", "LT-201", "LT-202", "FIT-201", "FIT-204", "LT-401", "FIT-601", "LT-701", "LT-011"]);
}
