import { StagePanelLocation, StagePanelSection, UiItemsManager, type UiItemsProvider, type Widget, WidgetState } from "@itwin/appui-react";
import { SvgFilter, SvgHierarchyTree, SvgInfo, SvgList, SvgModel, SvgPalette, SvgPropertiesList, SvgSave, SvgSearch } from "@itwin/itwinui-icons-react";
import { featureEnabled, type FeatureMap, useFeatureStore } from "../state/featureStore";
import { FILTERS_WIDGET_ID, FiltersWidget } from "../widgets/FiltersWidget";
import { GeometryWidget } from "../widgets/GeometryWidget";
import { OverviewWidget } from "../widgets/OverviewWidget";
import { LegendWidget } from "../widgets/LegendWidget";
import { PropertiesWidget } from "../widgets/PropertiesWidget";
import { SCHEMA_WIDGET_ID, SchemaWidget } from "../widgets/SchemaWidget";
import { SeedQueryWidget } from "../widgets/SeedQueryWidget";
import { SessionsWidget } from "../widgets/SessionsWidget";
import { VisibilityTreesWidget } from "../widgets/VisibilityTreesWidget";
import { MAIN_STAGE_ID } from "./MainFrontstage";
import { STATUS_BAR_ITEMS } from "./StatusBarItems";

/** Widgets are provided (not hard-wired into the stage) so a Studio host can place them in its own
 * frontstage. Optional widgets are dropped when their feature is switched off; a settings change
 * re-registers the provider, which makes AppUI refresh the panels live. */
export const instanceGraphUiProvider: UiItemsProvider = {
  id: "InstanceGraph:Widgets",
  getStatusBarItems: () => STATUS_BAR_ITEMS,
  provideWidgets(stageId, _usage, location, section): Widget[] {
    if (stageId !== MAIN_STAGE_ID) return [];
    const features = useFeatureStore.getState().features;
    const on = (id: Parameters<typeof featureEnabled>[0]) => featureEnabled(id, features);
    if (location === StagePanelLocation.Left && section === StagePanelSection.Start) {
      const widgets: Widget[] = [
        { id: "ig-seed", label: "Seed query", iconNode: <SvgSearch />, content: <SeedQueryWidget />, defaultState: WidgetState.Open, canPopout: false },
      ];
      if (on("overview")) widgets.push({ id: "ig-overview", label: "Overview", iconNode: <SvgList />, content: <OverviewWidget />, canPopout: false });
      if (on("sessions")) widgets.push({ id: "ig-sessions", label: "Sessions", iconNode: <SvgSave />, content: <SessionsWidget />, canPopout: false });
      return widgets;
    }
    if (location === StagePanelLocation.Left && section === StagePanelSection.End) {
      const widgets: Widget[] = [
        { id: FILTERS_WIDGET_ID, label: "Traversal & filters", iconNode: <SvgFilter />, content: <FiltersWidget />, defaultState: WidgetState.Open, canPopout: false },
      ];
      if (on("visibilityTrees")) widgets.push({ id: "ig-visibility", label: "Models & categories", iconNode: <SvgHierarchyTree />, content: <VisibilityTreesWidget />, canPopout: false });
      return widgets;
    }
    if (location === StagePanelLocation.Right && section === StagePanelSection.Start) {
      const widgets: Widget[] = [
        { id: "ig-properties", label: "Properties", iconNode: <SvgInfo />, content: <PropertiesWidget />, defaultState: WidgetState.Open, canPopout: false },
      ];
      if (on("schema")) widgets.push({ id: SCHEMA_WIDGET_ID, label: "Schema", iconNode: <SvgPropertiesList />, content: <SchemaWidget />, canPopout: false });
      if (on("geometry")) widgets.push({ id: "ig-geometry", label: "Geometry", iconNode: <SvgModel />, content: <GeometryWidget />, canPopout: false });
      return widgets;
    }
    if (location === StagePanelLocation.Right && section === StagePanelSection.End) {
      return on("legend")
        ? [{ id: "ig-legend", label: "Legend & colours", iconNode: <SvgPalette />, content: <LegendWidget />, defaultState: WidgetState.Open, canPopout: false }]
        : [];
    }
    return [];
  },
};

const WIDGET_FEATURES = ["overview", "sessions", "visibilityTrees", "schema", "geometry", "legend"] as const;

function widgetKey(features: FeatureMap): string {
  return WIDGET_FEATURES.map((id) => (featureEnabled(id, features) ? "1" : "0")).join("");
}

// Re-register when a widget-affecting feature flips: AppUI listens to provider registration and
// refreshes the frontstage's panel state, adding/removing tabs in place.
let lastWidgetKey = widgetKey(useFeatureStore.getState().features);
useFeatureStore.subscribe((s) => {
  const key = widgetKey(s.features);
  if (key === lastWidgetKey) return;
  lastWidgetKey = key;
  if (!UiItemsManager.getUiItemsProvider(instanceGraphUiProvider.id)) return;
  UiItemsManager.unregister(instanceGraphUiProvider.id);
  UiItemsManager.register(instanceGraphUiProvider);
});
