import { SvgChevronLeft, SvgChevronRight, SvgExport, SvgFitToView, SvgHierarchyTree, SvgNetwork } from "@itwin/itwinui-icons-react";
import { Button, ButtonGroup, DropdownMenu, IconButton, MenuDivider, MenuItem, ProgressRadial, Select, Text } from "@itwin/itwinui-react";
import { Panel, useReactFlow } from "@xyflow/react";
import { type DirectionFilter, parseNodeKey } from "../engine/GraphModel";
import { downloadText, exportPng, graphToCxl, graphToGraphML, graphToJson, safeFileStem, traversalRecipe } from "../services/exporters";
import { colorFor } from "../state/colorTheme";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";
import { ModeToggle } from "./ModeToggle";
import { graphActions, useGraphStore } from "../state/graphStore";

const DEPTHS = [1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: `Depth ${d}` }));
const DIRECTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: "both", label: "In & out" },
  { value: "forward", label: "Outgoing" },
  { value: "backward", label: "Incoming" },
];

export function GraphToolbar() {
  const canGoBack = useGraphStore((s) => s.canGoBack);
  const canGoForward = useGraphStore((s) => s.canGoForward);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const depth = useGraphStore((s) => s.options.depth);
  const direction = useGraphStore((s) => s.options.direction);
  const status = useGraphStore((s) => s.status);
  const hasGraph = useGraphStore((s) => s.graph.nodes.size > 0);
  const pins = useGraphStore((s) => s.pins);
  const rf = useReactFlow();

  const stem = () => safeFileStem(useGraphStore.getState().fileName);
  const exportItems = (close: () => void) => [
    <MenuItem key="json" onClick={() => { close(); downloadText(`${stem()}-graph.json`, JSON.stringify(graphToJson(useGraphStore.getState().graph), null, 2), "application/json"); }}>JSON</MenuItem>,
    <MenuItem key="graphml" onClick={() => { close(); downloadText(`${stem()}-graph.graphml`, graphToGraphML(useGraphStore.getState().graph), "application/xml"); }}>GraphML</MenuItem>,
    <MenuItem key="cxl" onClick={() => {
      close();
      const { graph, theme, fileName } = useGraphStore.getState();
      const positions = new Map(rf.getNodes().map((n) => [n.id, n.position]));
      const cxl = graphToCxl(graph, { title: `${safeFileStem(fileName)} instance graph`, positions, nodeSize: { width: NODE_WIDTH, height: NODE_HEIGHT }, colorOf: (n) => n.aggregate ? undefined : colorFor(n, theme) });
      downloadText(`${stem()}-graph.cxl`, cxl, "application/xml");
    }}>CmapTools (CXL)</MenuItem>,
    <MenuItem key="png" onClick={() => {
      close();
      const el = document.querySelector<HTMLElement>(".ig-canvas");
      if (el) void exportPng(`${stem()}-graph.png`, rf.getNodes(), el);
    }}>PNG image</MenuItem>,
    <MenuItem key="recipe" onClick={() => {
      close();
      const { graph, options } = useGraphStore.getState();
      const sql = traversalRecipe(graph, options.depth, options.direction);
      if (sql) void navigator.clipboard.writeText(sql);
    }}>Copy traversal as ECSQL</MenuItem>,
  ];

  const pinItems = (close: () => void) => [
    ...[...pins.values()].map((p) => (
      <MenuItem key={p.node.key} sublabel={p.node.className} subMenuItems={[
        <MenuItem key="centre" onClick={() => { close(); void graphActions.centreOn(parseNodeKey(p.node.key)); }}>Centre here</MenuItem>,
        <MenuItem key="unpin" onClick={() => { close(); graphActions.togglePin(p.node.key); }}>Unpin</MenuItem>,
      ]}>{p.node.label}</MenuItem>
    )),
    <MenuDivider key="div" />,
    <MenuItem key="all" onClick={() => { close(); graphActions.unpinAll(); }}>Unpin all</MenuItem>,
  ];

  return (
    <>
      <Panel position="top-left" className="ig-toolbar">
        <ModeToggle />
        <ButtonGroup>
          <IconButton size="small" styleType="borderless" label="Back (Alt+←)" disabled={!canGoBack} onClick={() => graphActions.back()}><SvgChevronLeft /></IconButton>
          <IconButton size="small" styleType="borderless" label="Forward (Alt+→)" disabled={!canGoForward} onClick={() => graphActions.forward()}><SvgChevronRight /></IconButton>
          <IconButton size="small" styleType="borderless" label="Fit to view (F)" onClick={() => graphActions.requestFit()}><SvgFitToView /></IconButton>
        </ButtonGroup>
        <ButtonGroup>
          <IconButton size="small" label="Radial layout" isActive={layoutMode === "radial"} onClick={() => graphActions.setLayoutMode("radial")}><SvgNetwork /></IconButton>
          <IconButton size="small" label="Layered layout" isActive={layoutMode === "layered"} onClick={() => graphActions.setLayoutMode("layered")}><SvgHierarchyTree /></IconButton>
        </ButtonGroup>
        <div className="ig-toolbar__select">
          <Select<number> size="small" options={DEPTHS} value={depth} onChange={(d) => graphActions.setOptions({ depth: d })} />
        </div>
        <div className="ig-toolbar__select">
          <Select<DirectionFilter> size="small" options={DIRECTIONS} value={direction} onChange={(d) => graphActions.setOptions({ direction: d })} />
        </div>
        {pins.size > 0 && (
          <DropdownMenu menuItems={pinItems}>
            <Button size="small" styleType="borderless" title="Pinned nodes" className="ig-toolbar__pins">📌 {pins.size}</Button>
          </DropdownMenu>
        )}
        <DropdownMenu menuItems={exportItems}>
          <IconButton size="small" styleType="borderless" label="Export" disabled={!hasGraph}><SvgExport /></IconButton>
        </DropdownMenu>
      </Panel>
      <Panel position="bottom-left" className="ig-status">
        {status.kind === "loading" && <ProgressRadial size="x-small" indeterminate />}
        <Text variant="small" className={status.kind === "error" ? "ig-status--error" : undefined}>
          {status.message ?? ""}
        </Text>
      </Panel>
    </>
  );
}
