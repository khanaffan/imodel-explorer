import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/frontend/engine/GraphEngine";
import type { GraphData, GraphEdge, GraphNode, NodeCategory } from "../src/frontend/engine/GraphModel";
import { NODE_HEIGHT, NODE_WIDTH, type Positions, radialLayout, reroot, spreadRing, stableRotation } from "../src/frontend/graph/layout";
import { easeInOutCubic, LayoutAnimator, type Scheduler } from "../src/frontend/graph/motion";
import { graphToCxl, graphToGraphML, graphToJson, safeFileStem, traversalRecipe } from "../src/frontend/services/exporters";
import { captureSession, deleteSession, listSessions, parseSession, storeSession } from "../src/frontend/services/sessionStore";
import { DEFAULT_APP_THEME, loadAppTheme, saveAppTheme } from "../src/frontend/state/appTheme";
import { colorFor, contrastText, DEFAULT_THEME, loadTheme, saveTheme } from "../src/frontend/state/colorTheme";
import { NavigationHistory } from "../src/frontend/state/navigationHistory";

function node(key: string, depth: number, extra: Partial<GraphNode> = {}): GraphNode {
  const [classId, id] = key.split(":");
  return {
    key, id, classId, className: "Test:Thing", schemaName: "Test", label: `N${id}`, category: "other" as NodeCategory,
    classHierarchy: ["Test:Thing", "BisCore:Element"], depth, expanded: false, ...extra,
  };
}

function edge(source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { key: `${source}>${target}`, source, target, relClassId: "0x99", relClassName: "Test:Rel", relInstanceId: "0x1", kind: "navigation", ...extra };
}

/** Star: centre with `inner` neighbours, the first of which has `outer` children. */
function star(inner: number, outer = 0): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const c = "0x10:0x1";
  nodes.set(c, node(c, 0));
  for (let i = 0; i < inner; i++) {
    const k = `0x10:0x${(100 + i).toString(16)}`;
    nodes.set(k, node(k, 1));
    const e = edge(c, k);
    edges.set(e.key, e);
  }
  const first = `0x10:0x${(100).toString(16)}`;
  for (let i = 0; i < outer; i++) {
    const k = `0x10:0x${(1000 + i).toString(16)}`;
    nodes.set(k, node(k, 2));
    const e = edge(first, k);
    edges.set(e.key, e);
  }
  return { centreKey: c, nodes, edges, truncated: false };
}

function overlaps(p: Positions): Array<[string, string]> {
  const list = [...p];
  const hits: Array<[string, string]> = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i];
      const [kb, b] = list[j];
      if (Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT)
        hits.push([ka, kb]);
    }
  return hits;
}

describe("radial layout", () => {
  it("puts the centre at the origin and every node somewhere", () => {
    const g = star(6, 4);
    const p = radialLayout(g);
    expect(p.size).toBe(g.nodes.size);
    const c = p.get(g.centreKey)!;
    expect(c.x + NODE_WIDTH / 2).toBeCloseTo(0);
    expect(c.y + NODE_HEIGHT / 2).toBeCloseTo(0);
  });

  it("does not overlap boxes even when one subtree dominates the wedges", () => {
    // Heavy subtree on one neighbour squeezes the other ring-1 nodes into narrow wedges.
    for (const [inner, outer] of [[3, 0], [8, 40], [12, 120], [40, 0], [5, 200]])
      expect(overlaps(radialLayout(star(inner, outer))), `${inner}/${outer}`).toEqual([]);
  });

  it("is deterministic", () => {
    const g = star(7, 9);
    expect([...radialLayout(g)]).toEqual([...radialLayout(g)]);
  });

  it("spreadRing preserves order and enforces spacing", () => {
    const r = 400;
    const out = spreadRing([0, 0.01, 0.02, 0.03, 3], r);
    for (let i = 1; i < 4; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    expect(out[4]).toBeGreaterThan(out[3]);
  });

  it("stableRotation keeps the previous centre on the same bearing after recentring", () => {
    const g = star(5, 3);
    const before = radialLayout(g);
    const newCentre = [...g.nodes.keys()][1];
    const rerooted = reroot(g, newCentre);
    const rot = stableRotation(rerooted, before, g.centreKey);
    const after = radialLayout(rerooted, rot);
    const bearing = (p: Positions, from: string, to: string) => {
      const a = p.get(from)!;
      const b = p.get(to)!;
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const wanted = bearing(before, newCentre, g.centreKey);
    const got = bearing(after, newCentre, g.centreKey);
    const diff = Math.atan2(Math.sin(wanted - got), Math.cos(wanted - got));
    expect(Math.abs(diff)).toBeLessThan(0.35);
  });

  it("reroot recomputes hop depths from the new centre", () => {
    const g = star(3, 2);
    const first = "0x10:0x64";
    const r = reroot(g, first);
    expect(r.centreKey).toBe(first);
    expect(r.nodes.get(first)!.depth).toBe(0);
    expect(r.nodes.get(g.centreKey)!.depth).toBe(1);
    expect(r.nodes.get("0x10:0x3e8")!.depth).toBe(1);
  });
});

describe("motion", () => {
  class FakeScheduler implements Scheduler {
    public t = 0;
    private _cbs = new Map<number, () => void>();
    private _next = 1;
    public now() { return this.t; }
    public request(cb: () => void) { const h = this._next++; this._cbs.set(h, cb); return h; }
    public cancel(h: number) { this._cbs.delete(h); }
    public tick(ms: number) { this.t += ms; const cbs = [...this._cbs.values()]; this._cbs.clear(); cbs.forEach((cb) => cb()); }
  }

  it("easing hits the endpoints", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it("interpolates from spawn origin to target and finishes exactly", () => {
    const s = new FakeScheduler();
    const frames: Array<{ x: number; done: boolean }> = [];
    const a = new LayoutAnimator((p, done) => frames.push({ x: p.get("n")!.x, done }), s);
    a.animateTo(new Map([["n", { x: 100, y: 0 }]]), () => ({ x: 0, y: 0 }), 100);
    s.tick(50);
    expect(frames.at(-1)!.x).toBeGreaterThan(0);
    expect(frames.at(-1)!.x).toBeLessThan(100);
    s.tick(60);
    expect(frames.at(-1)).toEqual({ x: 100, done: true });
    expect(a.running).toBe(false);
  });

  it("retargeting mid-flight starts from the current position", () => {
    const s = new FakeScheduler();
    const a = new LayoutAnimator(() => undefined, s);
    a.animateTo(new Map([["n", { x: 100, y: 0 }]]), () => ({ x: 0, y: 0 }), 100);
    s.tick(50);
    const mid = a.current.get("n")!.x;
    a.animateTo(new Map([["n", { x: -100, y: 0 }]]), () => undefined, 100);
    s.tick(1);
    expect(Math.abs(a.current.get("n")!.x - mid)).toBeLessThan(5);
  });
});

describe("navigation history", () => {
  const entry = (k: string) => ({ centreKey: k, label: k, graph: { centreKey: k, nodes: new Map(), edges: new Map(), truncated: false }, expandedGroups: new Set<string>(), pins: new Map(), pinEdges: new Map() });

  it("behaves like a browser", () => {
    const h = new NavigationHistory();
    h.push(entry("a")); h.push(entry("b")); h.push(entry("c"));
    expect(h.back()!.centreKey).toBe("b");
    expect(h.back()!.centreKey).toBe("a");
    expect(h.canGoBack).toBe(false);
    expect(h.forward()!.centreKey).toBe("b");
    h.push(entry("d"));
    expect(h.canGoForward).toBe(false);
    expect(h.entries.map((e) => e.centreKey)).toEqual(["a", "b", "d"]);
  });

  it("dedupes consecutive centres and honours the limit", () => {
    const h = new NavigationHistory(3);
    h.push(entry("a")); h.push(entry("a"));
    expect(h.entries.length).toBe(1);
    for (const k of ["b", "c", "d", "e"]) h.push(entry(k));
    expect(h.entries.map((e) => e.centreKey)).toEqual(["c", "d", "e"]);
    expect(h.current!.centreKey).toBe("e");
  });
});

describe("colour theme", () => {
  const n = { category: "geometric3d" as NodeCategory, classHierarchy: ["Plant:Pump", "BisCore:PhysicalElement"], schemaName: "Plant" };

  it("uses category colours by default and rules in order", () => {
    expect(colorFor(n, DEFAULT_THEME)).toBe(DEFAULT_THEME.categories.geometric3d);
    const theme = {
      ...DEFAULT_THEME,
      rules: [
        { id: "1", match: "BisCore:PhysicalElement", kind: "class" as const, polymorphic: false, color: "#111111" },
        { id: "2", match: "plant", kind: "schema" as const, polymorphic: false, color: "#222222" },
        { id: "3", match: "BisCore:PhysicalElement", kind: "class" as const, polymorphic: true, color: "#333333" },
      ],
    };
    expect(colorFor(n, theme)).toBe("#222222");
  });

  it("round-trips through storage and survives garbage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const theme = { ...DEFAULT_THEME, categories: { ...DEFAULT_THEME.categories, model: "#000000" } };
    saveTheme(theme, storage);
    expect(loadTheme(storage).categories.model).toBe("#000000");
    store.set("instanceGraph.colorTheme", "{not json");
    expect(loadTheme(storage)).toEqual(DEFAULT_THEME);
  });

  it("picks readable text", () => {
    expect(contrastText("#ffffff")).not.toBe(contrastText("#000000"));
  });
});

describe("app theme", () => {
  it("persists supported themes and rejects unknown values", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(loadAppTheme(storage)).toBe(DEFAULT_APP_THEME);
    expect(saveAppTheme("dark", storage)).toBeUndefined();
    expect(loadAppTheme(storage)).toBe("dark");
    store.set("instanceGraph.appTheme", "unknown");
    expect(loadAppTheme(storage)).toBe(DEFAULT_APP_THEME);
  });
});

describe("sessions and exporters", () => {
  const g = (() => {
    const s = star(2, 1);
    const nodes = new Map(s.nodes);
    const first = "0x10:0x64";
    nodes.set(first, { ...nodes.get(first)!, expanded: true, label: `Pipe <A> & "B"` });
    const edges = new Map(s.edges);
    const lt = edge(s.centreKey, "0x10:0x65", { key: "lt", kind: "linkTable", relInstanceId: "0x55", cardinality: { source: "0..1", target: "0..*" } });
    edges.set(lt.key, lt);
    return { ...s, nodes, edges };
  })();

  it("captures, stores, lists, parses and deletes sessions", () => {
    const opts = { ...DEFAULT_OPTIONS, depth: 1 };
    const s = captureSession("mine", "/x/y.bim", g, opts, "radial")!;
    expect(s.centre).toEqual({ classId: "0x10", id: "0x1" });
    expect(s.expandedNodes).toEqual(["0x10:0x64"]);

    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    storeSession(s, storage);
    expect(listSessions(storage).map((x) => x.name)).toEqual(["mine"]);
    expect(parseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
    deleteSession(s, storage);
    expect(listSessions(storage)).toEqual([]);
  });

  it("rejects foreign or malformed session files and clamps values", () => {
    expect(() => parseSession({ format: "other" })).toThrow();
    expect(() => parseSession({ format: "instance-graph-session", version: 1 })).toThrow();
    const p = parseSession({ format: "instance-graph-session", version: 1, centre: { id: "0x1", classId: "0x2" }, depth: 99, nodeBudget: -3, direction: "sideways" });
    expect(p.depth).toBe(6);
    expect(p.nodeBudget).toBe(750);
    expect(p.direction).toBe("both");
  });

  it("exports JSON and well-formed, escaped GraphML", () => {
    const j = graphToJson(g);
    expect(j.nodes.length).toBe(g.nodes.size);
    expect(j.edges.length).toBe(g.edges.size);
    const xml = graphToGraphML(g);
    expect(xml).toContain("Pipe &lt;A&gt; &amp; &quot;B&quot;");
    expect(xml).toContain("0..1 → 0..*");
    expect((xml.match(/<node /g) ?? []).length).toBe(g.nodes.size);
    expect((xml.match(/<edge /g) ?? []).length).toBe(g.edges.size);
  });

  it("exports a CmapTools CXL concept map", () => {
    const xml = graphToCxl(g, { positions: new Map([[g.centreKey, { x: -100, y: -50 }]]), colorOf: () => "#3b82f6" });
    expect(xml).toContain(`<cmap xmlns="http://cmap.ihmc.us/xml/cmap/"`);
    expect((xml.match(/<concept id=/g) ?? []).length).toBe(g.nodes.size);
    expect((xml.match(/<linking-phrase id=/g) ?? []).length).toBe(g.edges.size);
    expect((xml.match(/<connection id=/g) ?? []).length).toBe(2 * g.edges.size);
    expect(xml).toContain("Pipe &lt;A&gt; &amp; &quot;B&quot;");
    expect(xml).toContain("&#xa;0..1 → 0..*");
    expect(xml).toContain(`background-color="59,130,246,255"`);
    expect(xml).toContain(`font-color="255,255,255,255"`);
    expect(xml).not.toMatch(/ x="-/);
  });

  it("builds a runnable recipe and safe file names", () => {
    expect(traversalRecipe(g, 2, "both")).toContain("ECVLib.Relations");
    expect(traversalRecipe({ ...g, centreKey: "" }, 2, "both")).toBeUndefined();
    expect(safeFileStem("/a/b/My Plant?.bim")).not.toMatch(/[/?\s]/);
  });
});
