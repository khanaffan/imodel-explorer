import { Drawing, DrawingCategory, SubCategory } from "@itwin/core-backend";
import { IModel } from "@itwin/core-common";
import type { DemoContext } from "../demoModel";
import { appearance, type CategoryDef, Shape, type XYZ } from "./builder";

type Kind = "tank" | "pump" | "clarifier" | "filter" | "header";
interface Symbol { tag: string; kind: Kind; at: [number, number] }

const HALF_WIDTH: Record<Kind, number> = { tank: 2, pump: 1.2, clarifier: 3, filter: 2, header: 0.6 };

/** Schematic P&ID of the main process, each graphic linked to the physical element it represents. */
export function buildPid(ctx: DemoContext): void {
  const { db, w, models } = ctx;
  const drawing = Drawing.insert(db, models.drawings, "PID-001 Process Flow");
  const catId = DrawingCategory.insert(db, IModel.dictionaryId, "Process Diagrams", appearance("#37474f"));
  const cat: CategoryDef = {
    id: catId,
    subs: {
      Symbols: SubCategory.insert(db, catId, "Symbols", appearance("#37474f")),
      Process: SubCategory.insert(db, catId, "Process lines", appearance("#0288d1")),
      Chemical: SubCategory.insert(db, catId, "Chemical lines", appearance("#f9a825")),
      Sludge: SubCategory.insert(db, catId, "Sludge lines", appearance("#795548")),
    },
  };

  const symbols: Symbol[] = [
    { tag: "T-001", kind: "tank", at: [0, 0] },
    { tag: "P-101A", kind: "pump", at: [12, 5] }, { tag: "P-101B", kind: "pump", at: [12, -5] },
    { tag: "CL-201", kind: "clarifier", at: [25, 7] }, { tag: "CL-202", kind: "clarifier", at: [25, -7] },
    { tag: "F-301", kind: "filter", at: [40, 11] }, { tag: "F-302", kind: "filter", at: [40, 4] },
    { tag: "F-303", kind: "filter", at: [40, -4] }, { tag: "F-304", kind: "filter", at: [40, -11] },
    { tag: "T-401", kind: "tank", at: [54, 0] }, { tag: "H-400", kind: "header", at: [62, 0] },
    { tag: "P-501A", kind: "pump", at: [70, 7] }, { tag: "P-501B", kind: "pump", at: [70, 0] }, { tag: "P-501C", kind: "pump", at: [70, -7] },
    { tag: "H-601", kind: "header", at: [80, 0] },
    { tag: "CT-01", kind: "tank", at: [12, 20] }, { tag: "DP-01", kind: "pump", at: [19, 20] },
    { tag: "CT-02", kind: "tank", at: [48, 20] }, { tag: "DP-02", kind: "pump", at: [55, 20] },
    { tag: "T-701", kind: "tank", at: [34, -22] },
  ];
  const byTag = new Map(symbols.map((s) => [s.tag, s]));
  for (const s of symbols) {
    const graphic = w.insert("BisCore:DrawingGraphic", drawing, `PID-001 ${s.tag}`, {
      category: cat.id, placement: { origin: s.at, angle: 0 }, geom: symbolShape(cat, s).stream,
    });
    db.relationships.insertInstance({ classFullName: "BisCore:DrawingGraphicRepresentsElement", sourceId: graphic, targetId: w.id(s.tag) } as any);
  }

  const lines: Array<[string, string, string, keyof typeof cat.subs]> = [
    ["P-101A", "CL-201", "RW-102A", "Process"], ["P-101B", "CL-202", "RW-102B", "Process"],
    ["T-001", "P-101A", "RW-101A", "Process"], ["T-001", "P-101B", "RW-101B", "Process"],
    ["CL-201", "F-301", "SW-201", "Process"], ["CL-201", "F-302", "SW-202", "Process"],
    ["CL-202", "F-303", "SW-203", "Process"], ["CL-202", "F-304", "SW-204", "Process"],
    ["F-301", "T-401", "FW-301", "Process"], ["F-302", "T-401", "FW-302", "Process"],
    ["F-303", "T-401", "FW-303", "Process"], ["F-304", "T-401", "FW-304", "Process"],
    ["T-401", "H-400", "TW-400", "Process"],
    ["H-400", "P-501A", "TW-411A", "Process"], ["H-400", "P-501B", "TW-411B", "Process"], ["H-400", "P-501C", "TW-411C", "Process"],
    ["P-501A", "H-601", "TW-501A", "Process"], ["P-501B", "H-601", "TW-501B", "Process"], ["P-501C", "H-601", "TW-501C", "Process"],
    ["CT-01", "DP-01", "CH-100", "Chemical"], ["DP-01", "CL-201", "CH-101", "Chemical"],
    ["CT-02", "DP-02", "CH-400", "Chemical"], ["DP-02", "T-401", "CH-401", "Chemical"],
    ["CL-201", "T-701", "SL-201", "Sludge"], ["CL-202", "T-701", "SL-202", "Sludge"],
  ];
  for (const [from, to, pipe, sub] of lines) {
    const a = byTag.get(from)!;
    const b = byTag.get(to)!;
    const start: XYZ = [a.at[0] + HALF_WIDTH[a.kind], a.at[1], 0];
    const end: XYZ = [b.at[0] - HALF_WIDTH[b.kind], b.at[1], 0];
    const pts: XYZ[] = sub === "Sludge"
      ? [start, [start[0] + 1, start[1], 0], [start[0] + 1, b.at[1], 0], [b.at[0] - HALF_WIDTH[b.kind], b.at[1], 0]]
      : [start, [(start[0] + end[0]) / 2, start[1], 0], [(start[0] + end[0]) / 2, end[1], 0], end];
    const s = new Shape(cat.id, start).sub(cat.subs[sub]).line(pts);
    const tip = pts[pts.length - 1];
    s.sub(cat.subs[sub], true).polygon([tip, [tip[0] - 0.8, tip[1] + 0.35, 0], [tip[0] - 0.8, tip[1] - 0.35, 0], tip]);
    const graphic = w.insert("BisCore:DrawingGraphic", drawing, `PID-001 ${pipe}`, {
      category: cat.id, placement: { origin: [start[0], start[1]], angle: 0 }, geom: s.stream,
    });
    db.relationships.insertInstance({ classFullName: "BisCore:DrawingGraphicRepresentsElement", sourceId: graphic, targetId: w.id(pipe) } as any);
  }
}

function symbolShape(cat: CategoryDef, { kind, at: [x, y] }: Symbol): Shape {
  const s = new Shape(cat.id, [x, y, 0]).sub(cat.subs.Symbols);
  const rect = (hw: number, hh: number) => s.line([[x - hw, y - hh, 0], [x + hw, y - hh, 0], [x + hw, y + hh, 0], [x - hw, y + hh, 0], [x - hw, y - hh, 0]]);
  switch (kind) {
    case "tank":
      rect(2, 3).line([[x - 2, y + 2.4, 0], [x + 2, y + 2.4, 0]]);
      break;
    case "pump":
      s.circle([x, y, 0], 1.2).line([[x - 0.6, y - 1.04, 0], [x - 1, y - 1.7, 0], [x + 1, y - 1.7, 0], [x + 0.6, y - 1.04, 0]]);
      s.line([[x, y + 1.2, 0], [x + 1.2, y + 1.2, 0]]);
      break;
    case "clarifier":
      s.circle([x, y, 0], 3).circle([x, y, 0], 0.6).line([[x - 3, y, 0], [x + 3, y, 0]]);
      break;
    case "filter":
      rect(2, 1.5);
      for (let i = -1; i <= 1; i++)
        s.line([[x - 2, y + i * 0.5, 0], [x + 2, y + i * 0.5, 0]]);
      break;
    case "header":
      rect(0.6, 9);
      break;
  }
  return s;
}
