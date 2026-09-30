import type { DemoContext } from "../demoModel";
import { Shape } from "./builder";
import { Criticality } from "./process";

const range = (prefix: string, from: number, to: number, pad = 2) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, "0")}`);

export function buildOperations(ctx: DemoContext): void {
  buildAreas(ctx);
  buildTrains(ctx);
  buildWorkOrders(ctx);
  buildAspects(ctx);
}

function buildAreas(ctx: DemoContext): void {
  const { w, models, cats } = ctx;
  const a = cats.areas;
  const areas: Array<[string, string, [number, number, number, number], string[]]> = [
    ["A00", "Administration & Control", [-60, -36, -36, -20], ["Control building", "MCC-1", "MCC-2", "PLC-1"]],
    ["A10", "Raw Water Intake", [-62, 3, -34, 21], ["T-001", "P-101A", "P-101B", "M-101A", "M-101B", "RW-100", "RW-101A", "RW-101B", "V-101A", "V-101B", "V-102A", "V-102B", "V-103A", "V-103B", "FIT-101", "LT-001"]],
    ["A20", "Chemical Dosing", [-40, 20, 34, 31], ["CT-01", "CT-02", "DP-01", "DP-02", "CH-100", "CH-101", "CH-400", "CH-401", "LT-011"]],
    ["A30", "Clarification", [-22, -25, -2, 25], ["CL-201", "CL-202", "RW-102A", "RW-102B", "V-201", "V-202", "LT-201", "LT-202"]],
    ["A40", "Filtration", [0, -21, 24, 21], ["F-301", "F-302", "F-303", "F-304", "SW-201", "SW-202", "SW-203", "SW-204", "FW-301", "FW-302", "FW-303", "FW-304", "V-301", "V-302", "V-303", "V-304", "FIT-201", "FIT-204"]],
    ["A50", "Treated Water Storage & Pumping", [26, -14, 58, 19], ["T-401", "H-400", "TW-400", "V-400", "LT-401",
      ...["A", "B", "C"].flatMap((s) => [`P-501${s}`, `M-501${s}`, `TW-411${s}`, `TW-501${s}`, `V-501${s}`])]],
    ["A60", "Distribution", [59, -31, 70, 21], ["H-601", "FIT-601", ...range("SC-", 1, 30)]],
    ["A70", "Solids Handling", [-26, -35, -8, -26], ["T-701", "SL-201", "SL-202", "V-701", "V-702", "LT-701"]],
  ];
  for (const [code, name, [x0, y0, x1, y1], members] of areas) {
    const z = 0.03;
    const s = new Shape(a.id, [x0, y0, z]).sub(a.subs.Boundary).line([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]]);
    w.physical("WaterPlant:ProcessArea", models.areas, a, `${code} ${name}`, s, { areaCode: code });
    for (const m of members)
      w.link("WaterPlant:AreaIncludesElements", `${code} ${name}`, m);
  }
}

function buildTrains(ctx: DemoContext): void {
  const { w, models } = ctx;
  const trains: Array<[string, number, string[]]> = [
    ["Treatment Train 1", 12, ["CL-201", "F-301", "F-302"]],
    ["Treatment Train 2", 12, ["CL-202", "F-303", "F-304"]],
    ["Raw Water Pump Set", 14, ["P-101A", "P-101B", "M-101A", "M-101B"]],
    ["High-Lift Pump Set", 26, ["P-501A", "P-501B", "P-501C", "M-501A", "M-501B", "M-501C"]],
  ];
  for (const [name, designCapacity, members] of trains) {
    w.insert("WaterPlant:Train", models.trains, name, { designCapacity });
    members.forEach((m, i) => w.link("BisCore:ElementGroupsMembers", name, m, { memberPriority: i }));
  }
}

function buildWorkOrders(ctx: DemoContext): void {
  const { w, models } = ctx;
  const orders: Array<[string, "Open" | "InProgress" | "Closed", number, string, string[]]> = [
    ["Replace mechanical seal", "InProgress", Criticality.High, "2026-05-02", ["P-101A"]],
    ["Vibration survey – raw water pumps", "Open", Criticality.Medium, "2026-05-15", ["P-101A", "P-101B", "M-101A", "M-101B"]],
    ["Desludge and inspect clarifier", "Open", Criticality.Medium, "2026-06-01", ["CL-202", "SL-202", "V-702"]],
    ["Filter media top-up", "Closed", Criticality.Low, "2026-03-20", ["F-303"]],
    ["Backwash valve actuator fault", "InProgress", Criticality.High, "2026-04-30", ["V-302"]],
    ["Calibrate flow meters", "Open", Criticality.Medium, "2026-05-20", ["FIT-101", "FIT-201", "FIT-204", "FIT-601"]],
    ["Clearwell roof hatch repair", "Closed", Criticality.Low, "2026-02-11", ["T-401"]],
    ["Motor insulation test", "Open", Criticality.Medium, "2026-06-10", ["M-501A", "M-501B", "M-501C"]],
    ["Replace dosing pump diaphragm", "Open", Criticality.High, "2026-05-05", ["DP-02"]],
    ["Check valve slam investigation", "InProgress", Criticality.High, "2026-05-08", ["V-501B", "TW-501B", "P-501B"]],
    ["Thermographic survey of MCCs", "Closed", Criticality.Low, "2026-01-28", ["MCC-1", "MCC-2"]],
    ["Header leak repair at SC-17", "Open", Criticality.High, "2026-04-29", ["H-601", "SC-17"]],
  ];
  orders.forEach(([summary, status, priority, due, targets], i) => {
    const number = `WO-26-0${141 + i}`;
    w.insert("WaterPlant:WorkOrder", models.maintenance, number, { number, summary, status, priority, dueDate: `${due}T09:00:00.000` });
    for (const t of targets)
      w.link("WaterPlant:WorkOrderTargetsAsset", number, t);
  });
}

function buildAspects(ctx: DemoContext): void {
  const { db, w } = ctx;
  const nameplates: Array<[string, string, number]> = [
    ["P-101A", "Aquaflo", 2014], ["P-101B", "Aquaflo", 2014], ["M-101A", "Voltmax", 2014], ["M-101B", "Voltmax", 2021],
    ["P-501A", "Aquaflo", 2016], ["P-501B", "Aquaflo", 2016], ["P-501C", "Aquaflo", 2023],
    ["M-501A", "Voltmax", 2016], ["M-501B", "Voltmax", 2016], ["M-501C", "Voltmax", 2023],
    ["DP-01", "DoseTech", 2019], ["DP-02", "DoseTech", 2019], ["MCC-1", "PowerGrid", 2014], ["MCC-2", "PowerGrid", 2016],
  ];
  nameplates.forEach(([label, manufacturer, yearInstalled], i) => db.elements.insertAspect({
    classFullName: "WaterPlant:Nameplate", element: { id: w.id(label), relClassName: "BisCore:ElementOwnsUniqueAspect" },
    manufacturer, serialNumber: `${manufacturer.slice(0, 2).toUpperCase()}-${yearInstalled}-${String(1000 + i * 37)}`, yearInstalled,
  } as any));

  const inspections: Array<[string, string, string, string]> = [
    ["T-001", "2025-03-14", "Good", "J. Okafor"], ["T-001", "2026-03-10", "Fair", "J. Okafor"],
    ["CL-201", "2025-09-02", "Good", "M. Lindqvist"], ["CL-202", "2025-09-02", "Poor", "M. Lindqvist"],
    ["CL-202", "2026-02-18", "Fair", "M. Lindqvist"], ["T-401", "2025-11-21", "Good", "A. Rahman"],
    ["F-301", "2026-01-12", "Good", "A. Rahman"], ["F-303", "2026-01-12", "Fair", "A. Rahman"],
    ["P-501B", "2026-04-02", "Poor", "S. Moreau"], ["H-601", "2026-04-20", "Fair", "S. Moreau"],
  ];
  for (const [label, date, condition, inspector] of inspections) {
    db.elements.insertAspect({
      classFullName: "WaterPlant:Inspection", element: { id: w.id(label), relClassName: "BisCore:ElementOwnsMultiAspects" },
      inspectedOn: `${date}T10:00:00.000`, condition, inspector,
    } as any);
  }
}
