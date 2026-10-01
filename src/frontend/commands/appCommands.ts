import { getCanvasBridge } from "../graph/canvasBridge";
import { exportGraph, GRAPH_EXPORTS, type GraphExportKind } from "../graph/exportGraph";
import { appHost } from "../host/AppHost";
import { iModelPathProblem } from "../../common/iModelFiles";
import { closeCurrent, openAndShow } from "../imodel/session";
import { captureSession, listSessions, storeSession } from "../services/sessionStore";
import { notesFor } from "../services/annotations";
import { APP_THEMES, appThemeActions } from "../state/appTheme";
import { classGraphActions, useClassGraphStore } from "../state/classGraphStore";
import { featureActions, isFeatureEnabled } from "../state/featureStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import { parseNodeKey } from "../engine/GraphModel";
import { notify } from "./notify";
import { tourActions } from "./FirstRunTour";
import { currentDeepLink, openDeepLink } from "./deepLinks";
import { DEEP_LINK_PROTOCOL } from "../../common/deepLink";
import { paletteActions } from "./paletteStore";
import { shortcutSheetActions } from "./ShortcutSheet";
import { type AppCommand, type CommandSource, isEditable, registerCommands } from "./registry";

const needIModel = () => (useGraphStore.getState().connection ? undefined : "Open an iModel first.");
const needInstanceGraph = () => needIModel()
  ?? (useClassGraphStore.getState().mode !== "instances" ? "Switch to the instance graph first." : undefined);
const needGraph = () => needInstanceGraph() ?? (useGraphStore.getState().graph.nodes.size === 0 ? "Pick a seed instance first." : undefined);
const needCanvas = () => needGraph() ?? (getCanvasBridge() ? undefined : "Show the instance graph first.");
const selectedNode = () => {
  const s = useGraphStore.getState().selection;
  return s?.kind === "node" && !useGraphStore.getState().graph.nodes.get(s.key)?.aggregate ? s.key : undefined;
};

const sessionsForFile = () => {
  const fileName = useGraphStore.getState().fileName;
  return fileName ? listSessions().filter((s) => s.fileName === fileName) : [];
};

async function open(path: string | undefined) {
  if (path) await openAndShow(path);
}

/** Text undo/redo when a field has focus and the command came from the menu (macOS routes ⌘Z
 * there); filter undo/redo otherwise. Keyboard shortcuts in fields never reach here. */
function undoOrRedo(kind: "undo" | "redo", source: CommandSource) {
  if (source === "menu" && isEditable(document.activeElement)) {
    document.execCommand(kind);
    return;
  }
  const s = useGraphStore.getState();
  if (kind === "undo" && s.canUndoFilters) graphActions.undoFilters();
  else if (kind === "redo" && s.canRedoFilters) graphActions.redoFilters();
}

const isExportKind = (v: string | undefined): v is GraphExportKind => GRAPH_EXPORTS.some((e) => e.kind === v);

export const APP_COMMANDS: readonly AppCommand[] = [
  // File
  { id: "file.open", title: "Open iModel…", group: "File", shortcut: { key: "o", mod: true }, keywords: "bim file",
    run: async () => open(await appHost.pickIModelFile()) },
  { id: "file.openRecent", title: "Open recent", group: "File", keywords: "file history",
    disabledReason: () => (appHost.getRecentFiles().length ? undefined : "No recent files."),
    children: () => appHost.getRecentFiles().map((p) => ({ label: p, arg: p })),
    run: async (_source, arg) => {
      if (!arg || !appHost.getRecentFiles().includes(arg)) throw new Error("Pick a file from the recent list.");
      await open(arg);
    } },
  { id: "file.openPath", title: "Open iModel file", group: "File", inMenu: false, inPalette: false,
    run: async (_source, arg) => {
      const problem = iModelPathProblem(arg ?? "");
      if (problem) throw new Error(problem);
      await open(arg);
    } },
  { id: "file.close", title: "Close iModel", group: "File", disabledReason: needIModel, run: closeCurrent },
  { id: "file.saveSession", title: "Save session", group: "File", shortcut: { key: "s", mod: true }, keywords: "bookmark snapshot",
    disabledReason: needGraph,
    run: () => {
      const { graph, options, layoutMode, pins, fileName } = useGraphStore.getState();
      const session = fileName ? captureSession(`Session ${new Date().toLocaleString()}`, fileName, graph, options, layoutMode, pins, notesFor(fileName)) : undefined;
      if (!session) throw new Error("There is no centre instance to save.");
      storeSession(session);
      notify.success(`Saved "${session.name}". Find it in the Sessions panel.`);
    } },
  { id: "link.copy", title: "Copy link to this view", group: "File", keywords: "share url deep link clipboard",
    disabledReason: needGraph,
    run: async () => {
      const link = currentDeepLink();
      if (!link) throw new Error("There is no centre instance to link to.");
      await navigator.clipboard.writeText(link);
      notify.success("Link copied. Open it from the command palette (paste it) or, in a packaged build, from any app.");
    } },
  { id: "link.open", title: "Open link…", group: "File", keywords: "paste url deep link share",
    run: async (_source, arg) => {
      if (!arg) { paletteActions.open(`${DEEP_LINK_PROTOCOL}://`); return; }
      const link = await openDeepLink(arg);
      notify.success(`Opened link to ${link.file.split(/[\\/]/).pop()}.`);
    } },
  { id: "file.exportGraph", title: "Export graph", group: "File", keywords: "save download json graphml cxl png ecsql",
    disabledReason: needGraph,
    children: () => GRAPH_EXPORTS.map((e) => ({ label: e.label, arg: e.kind })),
    run: async (_source, arg) => {
      if (!isExportKind(arg)) throw new Error("Pick an export format.");
      notify.success(await exportGraph(arg, getCanvasBridge()?.getNodes()));
    } },

  // Edit
  { id: "edit.undo", title: "Undo", group: "Edit", keywords: "filter exclusion", shortcut: { key: "z", mod: true }, run: (source) => undoOrRedo("undo", source) },
  { id: "edit.redo", title: "Redo", group: "Edit", keywords: "filter exclusion", shortcut: { key: "z", mod: true, shift: true }, run: (source) => undoOrRedo("redo", source) },
  { id: "edit.clearFilters", title: "Clear all filters and exclusions", group: "Edit", keywords: "reset",
    disabledReason: needIModel, run: () => graphActions.clearFilters() },

  // View
  { id: "view.palette", title: "Command palette", group: "View", shortcut: { key: "k", mod: true }, inInputs: true, inPalette: false,
    keywords: "search go to", run: () => paletteActions.toggle() },
  { id: "view.settings", title: "App settings…", group: "View", shortcut: { key: ",", mod: true }, keywords: "preferences features",
    run: () => featureActions.openSettings() },
  { id: "view.instances", title: "Show instance graph", group: "View", disabledReason: needIModel,
    run: () => classGraphActions.setMode("instances") },
  { id: "view.classes", title: "Show class graph", group: "View", keywords: "schema",
    disabledReason: () => needIModel() ?? (isFeatureEnabled("classGraph") ? undefined : "Enable the class graph in App settings."),
    run: () => classGraphActions.setMode("classes") },
  { id: "view.theme", title: "Theme", group: "View", keywords: "dark light colour color appearance",
    children: () => APP_THEMES.map((t) => ({ label: t.label, arg: t.value })),
    run: (_source, arg) => {
      const theme = APP_THEMES.find((t) => t.value === arg);
      if (!theme) throw new Error("Pick a theme.");
      appThemeActions.setTheme(theme.value);
    } },
  { id: "view.fit", title: "Fit graph to view", group: "View", shortcut: { key: "f" }, keywords: "zoom",
    disabledReason: needGraph, run: () => graphActions.requestFit() },
  { id: "view.radial", title: "Radial layout", group: "View", disabledReason: needInstanceGraph, run: () => graphActions.setLayoutMode("radial") },
  { id: "view.layered", title: "Layered layout", group: "View", keywords: "hierarchy tree", disabledReason: needInstanceGraph,
    run: () => graphActions.setLayoutMode("layered") },

  // Graph
  { id: "graph.find", title: "Find in graph…", group: "Graph", shortcut: { key: "f", mod: true }, inInputs: true, keywords: "search highlight",
    disabledReason: needCanvas, run: () => getCanvasBridge()?.openFind() },
  { id: "graph.back", title: "Back", group: "Graph", shortcut: { key: "ArrowLeft", alt: true }, keywords: "history previous",
    disabledReason: () => needInstanceGraph() ?? (useGraphStore.getState().canGoBack ? undefined : "Nothing to go back to."),
    run: () => graphActions.back() },
  { id: "graph.forward", title: "Forward", group: "Graph", shortcut: { key: "ArrowRight", alt: true }, keywords: "history next",
    disabledReason: () => needInstanceGraph() ?? (useGraphStore.getState().canGoForward ? undefined : "Nothing to go forward to."),
    run: () => graphActions.forward() },
  { id: "graph.togglePin", title: "Pin or unpin selected node", group: "Graph", shortcut: { key: "p" },
    disabledReason: () => needGraph() ?? (selectedNode() ? undefined : "Select a node first (Shift-click)."),
    run: () => { const k = selectedNode(); if (k) graphActions.togglePin(k); } },
  { id: "graph.unpinAll", title: "Unpin all", group: "Graph",
    disabledReason: () => needGraph() ?? (useGraphStore.getState().pins.size ? undefined : "Nothing is pinned."),
    run: () => graphActions.unpinAll() },
  { id: "graph.pathToSelection", title: "Find path from centre to selected node", group: "Graph", keywords: "route shortest connect",
    disabledReason: () => needGraph() ?? (selectedNode() && selectedNode() !== useGraphStore.getState().graph.centreKey ? undefined : "Select a node other than the centre (Shift-click)."),
    run: async () => { const k = selectedNode(); if (k) await graphActions.findPath(parseNodeKey(k)); } },
  { id: "graph.pathTool", title: "Find path: click a target node", group: "Graph", keywords: "route shortest connect tool",
    disabledReason: needCanvas, run: () => getCanvasBridge()?.setTool("find-path") },
  { id: "graph.cancelPath", title: "Cancel path search", group: "Graph", keywords: "stop",
    disabledReason: () => (useGraphStore.getState().pathSearching ? undefined : "No path search is running."),
    run: () => { graphActions.cancelPathSearch(); } },
  { id: "graph.compareSession", title: "Compare current graph with session", group: "Graph", keywords: "diff changes difference",
    disabledReason: () => needGraph() ?? (sessionsForFile().length ? undefined : "Save a session for this iModel first."),
    children: () => sessionsForFile().map((s) => ({ label: s.name, arg: s.name })),
    run: async (_source, arg) => {
      const session = sessionsForFile().find((s) => s.name === arg);
      if (!session) throw new Error("Pick a saved session for this iModel.");
      await graphActions.diffSessions("current", session);
    } },
  { id: "graph.exitDiff", title: "Exit comparison", group: "Graph", keywords: "diff close",
    disabledReason: () => (useGraphStore.getState().diffView ? undefined : "No comparison is shown."),
    run: () => graphActions.exitDiff() },
  { id: "graph.cancel", title: "Cancel search, find or tool", group: "Graph", shortcut: { key: "Escape" }, inMenu: false, inPalette: false,
    disabledReason: () => (getCanvasBridge() || useGraphStore.getState().pathSearching ? undefined : "Nothing to cancel."),
    run: () => { if (!graphActions.cancelPathSearch()) getCanvasBridge()?.escape(); } },

  // Help
  { id: "help.shortcuts", title: "Keyboard shortcuts", group: "Help", shortcut: { key: "?" }, keywords: "keys hotkeys help",
    run: shortcutSheetActions.toggle },
  { id: "help.tour", title: "Take the tour", group: "Help", keywords: "help intro onboarding coach guide",
    disabledReason: () => (useGraphStore.getState().connection ? undefined : "Open an iModel first; the tour walks through its panels."),
    run: tourActions.start },
];

export function registerAppCommands(): () => void {
  return registerCommands(APP_COMMANDS);
}
