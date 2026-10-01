import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMenuModel } from "../src/common/menuIpc";
import { fuzzyScore } from "../src/frontend/commands/fuzzy";
import { setNotificationSink, type Notification } from "../src/frontend/commands/notify";
import { type AppCommand, formatShortcut, getCommand, matchesShortcut, registerCommands, runCommand, toAccelerator } from "../src/frontend/commands/registry";
import { DEFAULT_OPTIONS } from "../src/frontend/engine/GraphEngine";
import { emptyGraph, type GraphData, type GraphNode } from "../src/frontend/engine/GraphModel";
import { EMPTY_FILTERS } from "../src/frontend/engine/filters";
import { findMatches } from "../src/frontend/graph/findMatches";
import { graphActions, useGraphStore } from "../src/frontend/state/graphStore";
import { type HistoryEntry, NavigationHistory } from "../src/frontend/state/navigationHistory";

const key = (k: string, mod = false, shift = false, alt = false) => ({ key: k, metaKey: mod, ctrlKey: false, altKey: alt, shiftKey: shift });

describe("shortcuts", () => {
  it("matches modifiers exactly, with ⌘ on macOS and Ctrl elsewhere", () => {
    expect(matchesShortcut({ key: "k", mod: true }, key("K", true), true)).toBe(true);
    expect(matchesShortcut({ key: "k", mod: true }, key("k"), true)).toBe(false);
    expect(matchesShortcut({ key: "k", mod: true }, key("k", true), false)).toBe(false);
    expect(matchesShortcut({ key: "k", mod: true }, { ...key("k"), ctrlKey: true }, false)).toBe(true);
    expect(matchesShortcut({ key: "f" }, key("f", true), true)).toBe(false);
    expect(matchesShortcut({ key: "z", mod: true }, key("z", true, true), true)).toBe(false);
    expect(matchesShortcut({ key: "z", mod: true, shift: true }, key("z", true, true), true)).toBe(true);
    expect(matchesShortcut({ key: "ArrowLeft", alt: true }, key("ArrowLeft", false, false, true), true)).toBe(true);
    // Symbols that need Shift on most layouts match either way.
    expect(matchesShortcut({ key: "?" }, key("?", false, true), true)).toBe(true);
  });

  it("formats per platform and only gives chorded shortcuts a menu accelerator", () => {
    expect(formatShortcut({ key: "z", mod: true, shift: true }, true)).toBe("⌘⇧Z");
    expect(formatShortcut({ key: "ArrowLeft", alt: true }, false)).toBe("Alt+Left");
    expect(toAccelerator({ key: "z", mod: true, shift: true })).toBe("CmdOrCtrl+Shift+Z");
    expect(toAccelerator({ key: "ArrowRight", alt: true })).toBe("Alt+Right");
    expect(toAccelerator({ key: "," , mod: true })).toBe("CmdOrCtrl+,");
    expect(toAccelerator({ key: "f" })).toBeUndefined();
    expect(toAccelerator({ key: "Escape" })).toBeUndefined();
  });
});

describe("command registry", () => {
  const notes: Notification[] = [];
  beforeEach(() => { notes.length = 0; setNotificationSink((n) => notes.push(n)); });
  afterEach(() => setNotificationSink(undefined));

  it("unregisters only its own registrations", () => {
    const a: AppCommand = { id: "t.x", title: "A", group: "Edit", run: () => {} };
    const b: AppCommand = { ...a, title: "B" };
    const offA = registerCommands([a]);
    const offB = registerCommands([b]);
    offA();
    expect(getCommand("t.x")).toBe(b);
    offB();
    expect(getCommand("t.x")).toBeUndefined();
  });

  it("explains disabled, missing and failing commands instead of failing silently", async () => {
    const run = vi.fn();
    const off = registerCommands([
      { id: "t.off", title: "Off", group: "Edit", disabledReason: () => "Open an iModel first.", run },
      { id: "t.boom", title: "Boom", group: "Edit", run: async () => { throw new Error("kaput"); } },
      { id: "t.arg", title: "Arg", group: "Edit", run },
    ]);
    expect(await runCommand("t.off", "palette")).toBe(false);
    expect(await runCommand("t.none", "menu")).toBe(false);
    expect(await runCommand("t.boom", "menu")).toBe(false);
    expect(await runCommand("t.arg", "menu", "x")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("menu", "x");
    expect(notes).toEqual([
      { kind: "info", message: "Open an iModel first." },
      { kind: "warning", message: "\"t.none\" is not available here." },
      { kind: "error", message: "Boom failed: kaput" },
    ]);
    off();
  });
});

describe("menu model validation", () => {
  it("accepts a well-formed model and rejects malformed input", () => {
    const ok = { items: [{ id: "file.open", label: "Open…", group: "File", enabled: true, accelerator: "CmdOrCtrl+O" },
      { id: "view.theme", label: "Theme", group: "View", enabled: true, children: [{ label: "Dark", arg: "dark" }] }] };
    expect(parseMenuModel(ok)).toEqual(ok);
    expect(() => parseMenuModel({ items: [{ id: "x", label: "X", group: "Bogus", enabled: true }] })).toThrow(/malformed/);
    expect(() => parseMenuModel({ items: [{ id: "x", label: "X", group: "File", enabled: true, children: [{ label: 1 }] }] })).toThrow(/child/);
    expect(() => parseMenuModel(null)).toThrow(/no items/);
  });
});

describe("palette ranking", () => {
  it("requires an in-order subsequence and prefers prefixes and word starts", () => {
    expect(fuzzyScore("xyz", "Fit graph to view")).toBeUndefined();
    const titles = ["Find in graph…", "Fit graph to view", "Show class graph"];
    const ranked = titles.map((t) => [t, fuzzyScore("fit", t)] as const).filter(([, s]) => s !== undefined).sort((a, b) => b[1]! - a[1]!);
    expect(ranked[0][0]).toBe("Fit graph to view");
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("sv ses", "Save session")! > fuzzyScore("sv ses", "Show visibility settings and sessions") !).toBe(true);
  });
});

function node(k: string, label: string, depth: number, extra: Partial<GraphNode> = {}): GraphNode {
  const [classId, id] = k.split(":");
  return { key: k, id, classId, className: "Plant:Pump", schemaName: "Plant", label, category: "other", classHierarchy: [], depth, expanded: false, ...extra };
}

describe("find in graph", () => {
  const graph: GraphData = {
    ...emptyGraph("0x1:0x10"),
    nodes: new Map([
      ["0x1:0x10", node("0x1:0x10", "Header", 0)],
      ["0x1:0x12", node("0x1:0x12", "Pump-B", 2)],
      ["0x1:0x11", node("0x1:0x11", "Pump-A", 1)],
      ["agg", node("agg", "Pump group", 1, { aggregate: { ownerKey: "0x1:0x10", relClassId: "0x3", relClassName: "Plant:Feeds", direction: "forward", hiddenCount: 4 } })],
    ]),
  };
  it("matches label, class or id case-insensitively, nearest first, skipping groups", () => {
    expect(findMatches(graph, "pump-")).toEqual(["0x1:0x11", "0x1:0x12"]);
    expect(findMatches(graph, "PLANT:pump")).toEqual(["0x1:0x10", "0x1:0x11", "0x1:0x12"]);
    expect(findMatches(graph, "0x12")).toEqual(["0x1:0x12"]);
    expect(findMatches(graph, "  ")).toEqual([]);
  });
});

describe("navigation history", () => {
  const entry = (k: string, path?: HistoryEntry["path"]): HistoryEntry => ({
    centreKey: k, label: k, graph: emptyGraph(k), expandedGroups: new Set(), pins: new Map(), pinEdges: new Map(), ...(path ? { path } : {}),
  });
  it("jumps to any entry without dropping the forward branch", () => {
    const h = new NavigationHistory();
    for (const k of ["a", "b", "c"]) h.push(entry(k));
    expect(h.goTo(0)?.centreKey).toBe("a");
    expect(h.canGoForward).toBe(true);
    expect(h.goTo(2)?.centreKey).toBe("c");
    expect(h.goTo(2)).toBeUndefined();
    expect(h.goTo(5)).toBeUndefined();
    expect(h.goTo(-1)).toBeUndefined();
    expect(h.entries).toHaveLength(3);
  });
  it("keeps a path result as its own stop even when it starts at the current centre", () => {
    const h = new NavigationHistory();
    h.push(entry("a"));
    h.push(entry("a", { from: "a", to: "b" }));
    h.push(entry("a"));
    expect(h.entries.map((e) => !!e.path)).toEqual([false, true, false]);
  });
});

describe("filter undo/redo", () => {
  const centre = "0x1:0x10";
  const initial = useGraphStore.getState();
  beforeEach(() => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    graphActions.detach();
    useGraphStore.setState({ options: { ...DEFAULT_OPTIONS, filters: EMPTY_FILTERS }, graph: { ...emptyGraph(centre), nodes: new Map([[centre, node(centre, "Header", 0)]]) } });
    useGraphStore.setState({ baseGraph: useGraphStore.getState().graph });
  });
  afterEach(() => { vi.unstubAllGlobals(); useGraphStore.setState(initial, true); });

  it("undoes and redoes filter and exclusion edits, and a new edit drops the redo branch", () => {
    graphActions.setFilter("classes", "Plant:Pump", "exclude");
    graphActions.excludeInstance("0x1:0x11");
    expect(useGraphStore.getState().canUndoFilters).toBe(true);
    graphActions.undoFilters();
    expect(useGraphStore.getState().options.excludedInstances).toEqual([]);
    expect(useGraphStore.getState().options.filters.classes).toEqual({ "Plant:Pump": { state: "exclude", polymorphic: false } });
    graphActions.undoFilters();
    expect(useGraphStore.getState().options.filters).toEqual(EMPTY_FILTERS);
    expect(useGraphStore.getState()).toMatchObject({ canUndoFilters: false, canRedoFilters: true });
    graphActions.redoFilters();
    expect(useGraphStore.getState().options.filters.classes).toEqual({ "Plant:Pump": { state: "exclude", polymorphic: false } });
    graphActions.setFilter("relationships", "Plant:Feeds", "include");
    expect(useGraphStore.getState().canRedoFilters).toBe(false);
  });

  it("does not record depth changes, and is cleared on detach", () => {
    graphActions.setOptions({ depth: 3 });
    expect(useGraphStore.getState().canUndoFilters).toBe(false);
    graphActions.setFilter("classes", "Plant:Pump", "exclude");
    graphActions.detach();
    expect(useGraphStore.getState().canUndoFilters).toBe(false);
  });

  it("keeps the stacks when undo would exclude the current centre", () => {
    graphActions.excludeInstance("0x1:0x11");
    graphActions.clearFilters();
    useGraphStore.setState({ graph: { ...emptyGraph("0x1:0x11"), nodes: new Map([["0x1:0x11", node("0x1:0x11", "Pump-A", 0)]]) } });
    expect(() => graphActions.undoFilters()).toThrow(/centre cannot be excluded/);
    expect(useGraphStore.getState()).toMatchObject({ canUndoFilters: true, canRedoFilters: false });
  });
});
