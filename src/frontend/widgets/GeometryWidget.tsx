/** The Geometry widget: the selected element's geometry stream as a graphical stack and a formatted
 * op list, with placement / category / view / iModel-frame facts and a 3D range decorator. */
import { Button, ExpandableBlock, IconButton, Text, ToggleSwitch } from "@itwin/itwinui-react";
import { SvgExport, SvgZoomIn } from "@itwin/itwinui-icons-react";
import * as React from "react";
import { GeometryClass } from "@itwin/core-common";
import type { Fact, ParsedStream, StreamOp } from "../engine/geometryStream";
import {
  imodelFrameFacts, placementFacts, type PlacementSummary, subCategoryFacts, viewFacts,
} from "../engine/geometryFacts";
import { resolveNavTargetClassId } from "../engine/instanceProperties";
import { downloadText, geometryStreamToJson, safeFileStem } from "../services/exporters";
import { geometryActions, useGeometryStore } from "../state/geometryStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import { setGeometryDecoration } from "../content/geometryDecorator";
import { viewportSync } from "../content/viewportSync";
import { KIND_COLORS, StreamStack } from "./StreamStack";
import { stackInput } from "./streamStackLayout";
import "./widgets.css";

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return <ExpandableBlock title={title} size="small" isExpanded={open} onToggle={setOpen}>{children}</ExpandableBlock>;
}

/** Rows rendered before the "show more" affordance; parsing is never capped. */
const OP_RENDER_CAP = 500;

function FactRows({ facts }: { facts: readonly Fact[] }) {
  return (
    <div className="ig-props">
      {facts.map((f, i) => (
        <div key={`${f.name}-${i}`} className="ig-prop">
          <span className="ig-prop__name" title={f.name}>{f.name}</span>
          <span className="ig-prop__value" title={f.value}>
            {f.swatch && <span className="ig-swatch" style={{ background: f.swatch }} />}
            {f.value}
            {f.tag && <span className={`ig-chip ig-chip--${f.tag}`}>{f.tag}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

async function centreOnPart(partId: string): Promise<void> {
  const engine = useGraphStore.getState().engine;
  if (!engine) return;
  const classId = await resolveNavTargetClassId(engine.port, { id: partId, relClassName: "", targetBaseClass: "BisCore:GeometryPart" });
  if (classId) await graphActions.centreOn({ id: partId, classId });
}

function PartExpansion({ partId }: { partId: string }) {
  const entry = useGeometryStore((s) => s.expandedParts.get(partId));
  if (!entry) return null;
  if (entry.loading) return <Text variant="small" isMuted>Loading part…</Text>;
  if (entry.error) return <div className="ig-error">{entry.error}</div>;
  if (!entry.parsed) return null;
  return (
    <div className="ig-geom-part">
      {entry.parsed.ops.map((op) => <OpRow key={op.index} op={op} streamId={partId} />)}
    </div>
  );
}

function OpRow({ op, streamId }: { op: StreamOp; streamId: string }) {
  const selected = useGeometryStore((s) => streamId === "" && s.selectedOp === op.index);
  const expandedPart = useGeometryStore((s) => (op.partId !== undefined ? s.expandedParts.has(op.partId) : false));
  const [open, setOpen] = React.useState(false);
  const hasFacts = op.facts.length > 0 || op.appearance !== undefined;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <>
      <div
        ref={ref}
        className={`ig-geom-op${selected ? " ig-geom-op--selected" : ""}${op.notParsed ? " ig-geom-op--error" : ""}`}
        onClick={() => { if (streamId === "") geometryActions.selectOp(op.index); }}
      >
        <span className="ig-geom-op__dot" style={{ background: KIND_COLORS[op.kind] }} />
        <span className="ig-geom-op__index">#{op.index}</span>
        {hasFacts
          ? <button className="ig-caret" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? "▾" : "▸"}</button>
          : <span className="ig-caret" />}
        <span className="ig-geom-op__label" title={op.label}>{op.label}</span>
        {op.detail && <span className="ig-geom-op__detail" title={op.detail}>{op.detail}</span>}
        {op.notParsed && <span className="ig-chip ig-chip--kind">not parsed</span>}
      </div>
      {open && (
        <div className="ig-geom-op__facts">
          <FactRows facts={op.facts} />
          {op.partId !== undefined && (
            <div className="ig-row ig-row--wrap">
              <Button size="small" onClick={() => expandedPart ? geometryActions.collapsePart(op.partId!) : void geometryActions.expandPart(op.partId!)}>
                {expandedPart ? "Collapse part" : "Expand part"}
              </Button>
              <Button size="small" styleType="borderless" onClick={() => void centreOnPart(op.partId!)}>Centre graph on part</Button>
            </div>
          )}
        </div>
      )}
      {op.partId !== undefined && expandedPart && <PartExpansion partId={op.partId} />}
    </>
  );
}

function SummaryChips({ parsed }: { parsed: ParsedStream }) {
  const s = parsed.summary;
  const chips: string[] = [`${s.totalOps} ops`, `${s.primitives} primitives`];
  for (const [kind, count] of s.byKind)
    if (kind !== "geometry") chips.push(`${count} ${kind}`);
  if (s.points > 0) chips.push(`${s.points.toLocaleString()} points`);
  if (s.facets > 0) chips.push(`${s.facets.toLocaleString()} facets`);
  if (s.distinctParts > 0) chips.push(`${s.distinctParts} part${s.distinctParts === 1 ? "" : "s"}`);
  if (s.hasBRep) chips.push("BRep");
  if (s.viewIndependent) chips.push("view-independent");
  return <div className="ig-row ig-row--wrap">{chips.map((c) => <span key={c} className="ig-chip">{c}</span>)}</div>;
}

function CategorySection({ parsed, categoryId }: { parsed: ParsedStream; categoryId: string }) {
  const connection = useGraphStore((s) => s.connection);
  const subCats = React.useMemo(() => {
    const ids = new Set<string>();
    for (const op of parsed.ops)
      if (op.appearance) ids.add(op.appearance.subCategoryId);
    return [...ids];
  }, [parsed]);
  return (
    <>
      <FactRows facts={[{ name: "Category", value: categoryId }]} />
      {subCats.map((id) => {
        const app = connection?.subcategories.getSubCategoryAppearance(id);
        return app
          ? <FactRows key={id} facts={subCategoryFacts(app, id)} />
          : <Text key={id} variant="small" isMuted>Sub-category {id} (appearance not loaded)</Text>;
      })}
    </>
  );
}

function ViewSection({ parsed, categoryId, placement }: { parsed: ParsedStream; categoryId?: string; placement?: PlacementSummary }) {
  const vp = viewportSync.current();
  if (!vp) return <Text variant="small" isMuted>No viewport is attached.</Text>;
  const subCategoryIds = new Set<string>();
  const geometryClasses = new Set<GeometryClass>();
  for (const op of parsed.ops)
    if (op.appearance) {
      subCategoryIds.add(op.appearance.subCategoryId);
      geometryClasses.add(op.appearance.geometryClass);
    }
  const facts = viewFacts(
    {
      viewsCategory: (id) => vp.view.viewsCategory(id),
      isSubCategoryVisible: (id) => vp.isSubCategoryVisible(id),
      viewFlags: vp.viewFlags,
      frustumRange: vp.getFrustum().toRange(),
    },
    { categoryId, subCategoryIds: [...subCategoryIds], geometryClasses, worldRange: placement?.worldRange },
  );
  return <FactRows facts={facts} />;
}

function IModelFrameSection() {
  const connection = useGraphStore((s) => s.connection);
  if (!connection) return null;
  return <FactRows facts={imodelFrameFacts(connection)} />;
}

function GeometryBody() {
  const { target, loading, error, result, expandedParts, selectedOp } = useGeometryStore();
  const showDecoration = useGeometryStore((s) => s.showDecoration);
  const [renderCap, setRenderCap] = React.useState(OP_RENDER_CAP);
  React.useEffect(() => setRenderCap(OP_RENDER_CAP), [target?.id]);

  const placement = React.useMemo(
    () => (result && !result.emptyReason ? placementFacts(result.props.placement) : undefined),
    [result]);

  // Drive the 3D decoration from the toggle, the loaded placement and the selected op.
  React.useEffect(() => {
    if (!showDecoration || !placement) {
      setGeometryDecoration(undefined);
      return;
    }
    const op = selectedOp !== undefined ? result?.parsed?.ops.find((o) => o.index === selectedOp) : undefined;
    setGeometryDecoration({
      placement: placement.placement,
      worldRange: placement.worldRange,
      selectedLocalRange: op?.localRange,
    });
    return () => setGeometryDecoration(undefined);
  }, [showDecoration, placement, selectedOp, result]);

  if (!target) return <Text isMuted>Select an element in the graph to inspect its geometry stream.</Text>;
  if (loading) return <Text variant="small" isMuted>Loading geometry…</Text>;
  if (error) return <div className="ig-error">{error}</div>;
  if (!result) return null;
  if (result.emptyReason) return <Text isMuted>{result.emptyReason}</Text>;
  const parsed = result.parsed;
  if (!parsed) return null;

  const expandedOps = new Map([...expandedParts].flatMap(([id, e]) => (e.parsed ? [[id, e.parsed.ops] as const] : [])));
  const stackOps = stackInput(parsed.ops, expandedOps);
  const shownOps = parsed.ops.slice(0, renderCap);
  const selectFromStack = (streamId: string, index: number) => {
    if (streamId === "") geometryActions.selectOp(index);
    else {
      const refOp = parsed.ops.find((o) => o.partId === streamId);
      if (refOp) geometryActions.selectOp(refOp.index);
    }
  };

  return (
    <>
      <SummaryChips parsed={parsed} />
      <Section title="Stack" defaultOpen>
        <StreamStack ops={stackOps} selected={selectedOp !== undefined ? { streamId: "", index: selectedOp } : undefined} onSelect={selectFromStack} />
      </Section>
      <Section title={`Ops (${parsed.ops.length})`} defaultOpen>
        <div className="ig-geom-ops">
          {shownOps.map((op) => <OpRow key={op.index} op={op} streamId="" />)}
          {parsed.ops.length > renderCap && (
            <button className="ig-link" onClick={() => setRenderCap(renderCap + OP_RENDER_CAP)}>
              Show {Math.min(OP_RENDER_CAP, parsed.ops.length - renderCap)} more of {parsed.ops.length - renderCap} remaining
            </button>
          )}
        </div>
      </Section>
      {placement && <Section title="Placement">{<FactRows facts={placement.facts} />}</Section>}
      {result.props.category !== undefined && (
        <Section title="Category & sub-categories"><CategorySection parsed={parsed} categoryId={result.props.category} /></Section>
      )}
      <Section title="View"><ViewSection parsed={parsed} categoryId={result.props.category} placement={placement} /></Section>
      <Section title="iModel frame"><IModelFrameSection /></Section>
    </>
  );
}

export function GeometryWidget() {
  const target = useGeometryStore((s) => s.target);
  const result = useGeometryStore((s) => s.result);
  const follow = useGeometryStore((s) => s.follow);
  const wantBRep = useGeometryStore((s) => s.wantBRep);
  const showDecoration = useGeometryStore((s) => s.showDecoration);
  const fileName = useGraphStore((s) => s.fileName);

  const exportJson = () => {
    if (!target || !result) return;
    downloadText(
      `${safeFileStem(fileName)}-${target.id}-geometry.json`,
      geometryStreamToJson({
        id: target.id, className: target.className, label: target.label,
        placement: result.props.placement, category: result.props.category, geom: result.props.geom,
      }),
      "application/json");
  };

  return (
    <div className="ig-widget" data-testid="geometry-widget">
      {target && (
        <div className="ig-card">
          <div className="ig-card__title">{target.label ?? target.id}</div>
          {target.className && <div className="ig-card__sub"><code>{target.className}</code></div>}
          <div className="ig-card__sub">Id <code>{target.id}</code></div>
        </div>
      )}
      <div className="ig-row ig-row--wrap">
        <ToggleSwitch label="Follow selection" checked={follow} onChange={(e) => geometryActions.setFollow(e.target.checked)} size="small" />
        <ToggleSwitch label="BRep data" checked={wantBRep} onChange={(e) => geometryActions.setWantBRep(e.target.checked)} size="small" />
        <ToggleSwitch label="Range & axes" checked={showDecoration} onChange={(e) => geometryActions.setShowDecoration(e.target.checked)} size="small" />
        <IconButton size="small" styleType="borderless" label="Export stream JSON" disabled={!result || !!result.emptyReason} onClick={exportJson}><SvgExport /></IconButton>
        <IconButton size="small" styleType="borderless" label="Zoom to element" disabled={!target} onClick={() => target && viewportSync.zoomTo(target.id)}><SvgZoomIn /></IconButton>
      </div>
      <GeometryBody />
    </div>
  );
}
