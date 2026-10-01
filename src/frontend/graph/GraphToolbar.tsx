import { SvgAdd, SvgChevronLeft, SvgChevronRight, SvgCursor, SvgExport, SvgFitToView, SvgFlag, SvgHierarchyTree, SvgLayers, SvgLink, SvgModel, SvgNetwork, SvgRemove, SvgSearch, SvgSelection, SvgSettings } from "@itwin/itwinui-icons-react";
import { Breadcrumbs, Button, ButtonGroup, DropdownMenu, IconButton, MenuDivider, MenuItem, ProgressRadial, Select, Text } from "@itwin/itwinui-react";
import { Panel } from "@xyflow/react";
import { type DirectionFilter, parseNodeKey } from "../engine/GraphModel";
import { runCommand } from "../commands/registry";
import { featureActions } from "../state/featureStore";
import { GRAPH_EXPORTS } from "./exportGraph";
import { ModeToggle } from "./ModeToggle";
import { graphActions, useGraphStore } from "../state/graphStore";
import { GRAPH_TOOLS, type GraphTool, type ToolResult } from "./graphTools";

const DEPTHS = [1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: `Depth ${d}` }));
const DIRECTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: "both", label: "In & out" },
  { value: "forward", label: "Outgoing" },
  { value: "backward", label: "Incoming" },
];

const TOOL_ICONS = {
  navigate: SvgCursor,
  "find-path": SvgFlag,
  "include-relationship": SvgLink,
  "exclude-relationship": SvgLink,
  "include-class": SvgLayers,
  "exclude-class": SvgLayers,
  "exclude-instance": SvgSelection,
  "include-model": SvgModel,
  "exclude-model": SvgModel,
} satisfies Record<GraphTool, typeof SvgCursor>;

function ToolIcon({ tool }: { tool: GraphTool }) {
  const TargetIcon = TOOL_ICONS[tool];
  const BadgeIcon = tool.startsWith("include-") ? SvgAdd : SvgRemove;
  return (
    <svg className="ig-tool-icon" viewBox="0 0 20 20" width={16} height={16} aria-hidden="true" focusable="false" data-tool={tool}>
      <TargetIcon width={16} height={16} fill="currentColor" />
      {tool !== "navigate" && tool !== "find-path" && <>
        <circle cx={15.5} cy={15.5} r={4.5} fill="var(--iui-color-background, #fff)" />
        <BadgeIcon x={11} y={11} width={9} height={9} fill="currentColor" />
      </>}
    </svg>
  );
}

export function GraphToolbar({ tool, onToolChange, feedback }: { tool: GraphTool; onToolChange: (tool: GraphTool) => void; feedback?: ToolResult }) {
  const canGoBack = useGraphStore((s) => s.canGoBack);
  const canGoForward = useGraphStore((s) => s.canGoForward);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const depth = useGraphStore((s) => s.options.depth);
  const direction = useGraphStore((s) => s.options.direction);
  const status = useGraphStore((s) => s.status);
  const hasGraph = useGraphStore((s) => s.graph.nodes.size > 0);
  const pins = useGraphStore((s) => s.pins);
  const crumbs = useGraphStore((s) => s.crumbs);
  const pathSearching = useGraphStore((s) => s.pathSearching);
  const crumbIndex = useGraphStore((s) => s.crumbIndex);
  const diffView = useGraphStore((s) => s.diffView);
  const activeTool = GRAPH_TOOLS.find((entry) => entry.id === tool)!;

  const exportItems = (close: () => void) => GRAPH_EXPORTS.map((e) => (
    <MenuItem key={e.kind} onClick={() => { close(); void runCommand("file.exportGraph", "ui", e.kind); }}>{e.label}</MenuItem>
  ));

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
        <DropdownMenu menuItems={(close) => GRAPH_TOOLS.map((entry) =>
          <MenuItem key={entry.id} startIcon={<ToolIcon tool={entry.id} />} onClick={() => { close(); onToolChange(entry.id === tool ? "navigate" : entry.id); }}>{entry.label}</MenuItem>)}>
          <Button size="small" className="ig-toolbar__tool" data-tour="tools" startIcon={<ToolIcon tool={tool} />} styleType={tool === "navigate" ? "default" : "high-visibility"}
            aria-pressed={tool !== "navigate"} title={`${activeTool.hint} Escape returns to Navigate.`}>Tool: {activeTool.label}</Button>
        </DropdownMenu>
        <ButtonGroup>
          <IconButton size="small" styleType="borderless" label="Back (Alt+←)" disabled={!canGoBack} onClick={() => graphActions.back()}><SvgChevronLeft /></IconButton>
          <IconButton size="small" styleType="borderless" label="Forward (Alt+→)" disabled={!canGoForward} onClick={() => graphActions.forward()}><SvgChevronRight /></IconButton>
          <IconButton size="small" styleType="borderless" label="Fit to view (F)" onClick={() => graphActions.requestFit()}><SvgFitToView /></IconButton>
          <IconButton size="small" styleType="borderless" label="Find in graph (⌘/Ctrl+F)" disabled={!hasGraph} onClick={() => void runCommand("graph.find", "ui")}><SvgSearch /></IconButton>
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
        <IconButton size="small" styleType="borderless" label="App settings" onClick={featureActions.openSettings}><SvgSettings /></IconButton>
        {crumbs.length > 1 && (
          <Breadcrumbs className="ig-crumbs" currentIndex={crumbIndex} aria-label="Graph history">
            {crumbs.map((c, i) => (
              <Breadcrumbs.Item key={i} onClick={i === crumbIndex ? undefined : () => graphActions.goToHistory(i)} title={c.label}
                className={c.isPath ? "ig-crumbs__item ig-crumbs__path" : "ig-crumbs__item"}>{c.label}</Breadcrumbs.Item>
            ))}
          </Breadcrumbs>
        )}
        {diffView && (
          <div className="ig-diff-banner" role="status" data-testid="diff-banner">
            <Text variant="small" className="ig-diff-banner__title">Comparing {diffView.label}</Text>
            <span className="ig-diff-banner__chip ig-diff-banner__chip--added">+{diffView.diff.counts.nodes.added} added</span>
            <span className="ig-diff-banner__chip ig-diff-banner__chip--removed">−{diffView.diff.counts.nodes.removed} removed</span>
            <span className="ig-diff-banner__chip">{diffView.diff.counts.nodes.same} unchanged</span>
            <Button size="small" styleType="borderless" onClick={() => graphActions.exitDiff()}>Exit comparison</Button>
          </div>
        )}
        {tool !== "navigate" && <div className="ig-tool-hint">
          <Text variant="small">{activeTool.hint} Escape to cancel.</Text>
          {feedback && <Text variant="small" role="status" className={feedback.kind === "invalid" ? "ig-status--error" : undefined}>{feedback.message}</Text>}
        </div>}
      </Panel>
      <Panel position="bottom-left" className="ig-status">
        {status.kind === "loading" && <ProgressRadial size="x-small" indeterminate />}
        <Text variant="small" className={status.kind === "error" ? "ig-status--error" : undefined}>
          {status.message ?? ""}
        </Text>
        {pathSearching && <Button size="small" styleType="borderless" onClick={() => graphActions.cancelPathSearch()}>Cancel</Button>}
      </Panel>
    </>
  );
}
