import { beforeEach, describe, expect, it } from "vitest";
import { buildDeepLink, findDeepLinkArg, looksLikeDeepLink, parseDeepLink } from "../src/common/deepLink";
import type { GraphData, GraphNode, NodeCategory } from "../src/frontend/engine/GraphModel";
import { DEFAULT_OPTIONS } from "../src/frontend/engine/GraphEngine";
import { deleteSeed, listAllSeeds, listSeedHistory, listSeedsFor, recordSeedQuery, SEED_HISTORY_LIMIT, storeSeed } from "../src/frontend/services/seedLibrary";
import { captureSession, parseSession } from "../src/frontend/services/sessionStore";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

describe("deep links", () => {
  it("round-trips a link with a centre and session, including awkward paths", () => {
    const link = { file: "/Users/me/My Models/plant & co.bim", centre: { classId: "0x9a", id: "0x2000000001f" }, session: "Pumps: west" };
    expect(parseDeepLink(buildDeepLink(link))).toEqual(link);
    expect(parseDeepLink(buildDeepLink({ file: "C:\\data\\x.ibim" }))).toEqual({ file: "C:\\data\\x.ibim" });
  });

  it("normalizes centre ids to lowercase and tolerates surrounding whitespace", () => {
    expect(parseDeepLink("  imodel-explorer://open?file=/a.bim&centre=0X1A:0XFF \n").centre).toEqual({ classId: "0x1a", id: "0xff" });
  });

  it.each([
    ["https://example.com/open?file=/a.bim", /Not an iModel Data Explorer link/],
    ["imodel-explorer://delete?file=/a.bim", /Unknown link action "delete"/],
    ["imodel-explorer://open?file=/a.bim&x=1", /Unknown link parameter "x"/],
    ["imodel-explorer://open?file=/a.bim&file=/b.bim", /repeats "file"/],
    ["imodel-explorer://open", /does not name a file/],
    ["imodel-explorer://open?file=relative/a.bim", /absolute path/],
    ["imodel-explorer://open?file=/etc/passwd", /is not an iModel/],
    ["imodel-explorer://open?file=/a.bim&centre=0x1", /not an instance key/],
    ["imodel-explorer://open?file=/a.bim&centre=0x0:0x1", /not an instance key/],
    ["imodel-explorer://open?file=/a.bim&centre=12:34", /not an instance key/],
    ["imodel-explorer://open?file=/a.bim&centre=0x1:0x2:0x3", /not an instance key/],
    ["imodel-explorer://open?file=/a.bim&centre=0x1:0x12345678901234567", /not an instance key/],
    ["imodel-explorer://open?file=/a.bim&session=%20", /session name is empty/],
    [`imodel-explorer://open?file=/a.bim&session=${"s".repeat(201)}`, /too long/],
    [`imodel-explorer://open?file=/${"a".repeat(5000)}.bim`, /link is too long/],
  ])("rejects %s", (text, error) => {
    expect(() => parseDeepLink(text)).toThrow(error);
  });

  it("finds the link among command-line arguments", () => {
    expect(findDeepLinkArg(["/app/electron", ".", "--flag", "IMODEL-EXPLORER://open?file=/a.bim"])).toBe("IMODEL-EXPLORER://open?file=/a.bim");
    expect(findDeepLinkArg(["/app/electron", "."])).toBeUndefined();
    expect(looksLikeDeepLink("imodel-explorer://anything")).toBe(true);
  });
});

describe("seed library", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => { storage = memoryStorage(); });
  const seed = (name: string, savedAt: string, fileName?: string) => ({ name, ecsql: `SELECT ${name}`, savedAt, ...(fileName ? { fileName } : {}) });

  it("lists file-scoped seeds first, then global ones, newest first, and hides other files' seeds", () => {
    storeSeed(seed("g1", "2024-01-01"), storage);
    storeSeed(seed("g2", "2024-03-01"), storage);
    storeSeed(seed("a", "2024-02-01", "/a.bim"), storage);
    storeSeed(seed("b", "2024-04-01", "/b.bim"), storage);
    expect(listSeedsFor("/a.bim", storage).map((s) => s.name)).toEqual(["a", "g2", "g1"]);
    expect(listSeedsFor(undefined, storage).map((s) => s.name)).toEqual(["g2", "g1"]);
  });

  it("replaces a seed with the same name in the same scope only, and deletes by scope", () => {
    storeSeed(seed("pumps", "2024-01-01"), storage);
    storeSeed(seed("pumps", "2024-01-02", "/a.bim"), storage);
    storeSeed({ ...seed("pumps", "2024-01-03"), ecsql: "SELECT 2", description: "  newer  " }, storage);
    const all = listAllSeeds(storage);
    expect(all).toHaveLength(2);
    expect(all.find((s) => !s.fileName)).toMatchObject({ ecsql: "SELECT 2", description: "newer" });
    deleteSeed({ name: "pumps", fileName: "/a.bim" }, storage);
    expect(listAllSeeds(storage).map((s) => s.fileName)).toEqual([undefined]);
  });

  it("rejects seeds without a name or query and skips corrupt stored entries", () => {
    expect(() => storeSeed(seed(" ", "2024"), storage)).toThrow(/no name/);
    expect(() => storeSeed({ ...seed("x", "2024"), ecsql: "  " }, storage)).toThrow(/no query/);
    storage.setItem("instanceGraph.savedSeeds", JSON.stringify([null, { name: "ok", ecsql: "SELECT 1", savedAt: "2024" }, { name: 3 }]));
    expect(listAllSeeds(storage).map((s) => s.name)).toEqual(["ok"]);
    storage.setItem("instanceGraph.savedSeeds", "{not json");
    expect(listAllSeeds(storage)).toEqual([]);
  });

  it("keeps the query history deduplicated, newest first and bounded", () => {
    for (let i = 0; i < SEED_HISTORY_LIMIT + 5; i++) recordSeedQuery(`SELECT ${i}`, storage);
    recordSeedQuery("  SELECT 10 ", storage);
    recordSeedQuery("   ", storage);
    const history = listSeedHistory(storage);
    expect(history).toHaveLength(SEED_HISTORY_LIMIT);
    expect(history.slice(0, 2)).toEqual(["SELECT 10", `SELECT ${SEED_HISTORY_LIMIT + 4}`]);
    expect(history.filter((q) => q === "SELECT 10")).toHaveLength(1);
  });
});

describe("annotations", () => {
  function node(key: string, depth: number): GraphNode {
    const [classId, id] = key.split(":");
    return { key, id, classId, className: "T:X", schemaName: "T", label: key, category: "other" as NodeCategory, classHierarchy: ["T:X"], depth, expanded: false };
  }
  const graph: GraphData = { centreKey: "0x1:0xc", nodes: new Map([["0x1:0xc", node("0x1:0xc", 0)], ["0x1:0xa", node("0x1:0xa", 1)]]), edges: new Map(), truncated: false };

  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });

  it("validates notes: keeps valid keys, lowercases them, trims and caps the text", async () => {
    const { parseNotes, NOTE_MAX_LENGTH } = await import("../src/frontend/services/annotations");
    expect(parseNotes({ "0X1:0XA": "  hello ", bad: "x", "0x1:0xb": 3, "0x1:0xc": "   ", "0x1:0xd": "y".repeat(NOTE_MAX_LENGTH + 10) }))
      .toEqual({ "0x1:0xa": "hello", "0x1:0xd": "y".repeat(NOTE_MAX_LENGTH) });
    expect(parseNotes(["x"])).toEqual({});
    expect(parseNotes(null)).toEqual({});
  });

  it("sets, removes and persists notes per file, and merges without overwriting", async () => {
    const { annotationActions, notesFor, NOTE_MAX_LENGTH } = await import("../src/frontend/services/annotations");
    annotationActions.setNote("/a.bim", "0x1:0xA", " check valve ");
    expect(notesFor("/a.bim")).toEqual({ "0x1:0xa": "check valve" });
    expect(notesFor("/b.bim")).toEqual({});
    expect(JSON.parse(localStorage.getItem("instanceGraph.annotations")!)).toEqual({ "/a.bim": { "0x1:0xa": "check valve" } });
    expect(() => annotationActions.setNote("/a.bim", "nope", "x")).toThrow(/Not an instance key/);
    expect(() => annotationActions.setNote("/a.bim", "0x1:0xa", "z".repeat(NOTE_MAX_LENGTH + 1))).toThrow(/limited/);

    expect(annotationActions.mergeNotes("/a.bim", { "0x1:0xa": "from session", "0x1:0xc": "centre" })).toBe(1);
    expect(notesFor("/a.bim")).toEqual({ "0x1:0xa": "check valve", "0x1:0xc": "centre" });

    annotationActions.setNote("/a.bim", "0x1:0xa", "");
    annotationActions.setNote("/a.bim", "0x1:0xc", "  ");
    expect(notesFor("/a.bim")).toEqual({});
    expect(JSON.parse(localStorage.getItem("instanceGraph.annotations")!)).toEqual({});
  });

  it("round-trips session annotations for nodes in the graph only, and drops invalid ones on import", () => {
    const s = captureSession("s", "/a.bim", graph, DEFAULT_OPTIONS, "radial", new Map(), { "0x1:0xa": "note", "0x1:0xff": "not in graph" })!;
    expect(s.annotations).toEqual({ "0x1:0xa": "note" });
    expect(parseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseSession({ ...s, annotations: { bad: "x", "0x1:0xa": 5 } }).annotations).toBeUndefined();
    expect(captureSession("s", "/a.bim", graph, DEFAULT_OPTIONS, "radial")!.annotations).toBeUndefined();
  });
});
