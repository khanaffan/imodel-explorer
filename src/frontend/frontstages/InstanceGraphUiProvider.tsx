import { StagePanelLocation, StagePanelSection, type UiItemsProvider, type Widget, WidgetState } from "@itwin/appui-react";
import { SvgFilter, SvgHierarchyTree, SvgInfo, SvgList, SvgModel, SvgPalette, SvgPropertiesList, SvgSave, SvgSearch } from "@itwin/itwinui-icons-react";
import { FiltersWidget } from "../widgets/FiltersWidget";
import { GeometryWidget } from "../widgets/GeometryWidget";
import { OverviewWidget } from "../widgets/OverviewWidget";
import { LegendWidget } from "../widgets/LegendWidget";
import { PropertiesWidget } from "../widgets/PropertiesWidget";
import { SCHEMA_WIDGET_ID, SchemaWidget } from "../widgets/SchemaWidget";
import { SeedQueryWidget } from "../widgets/SeedQueryWidget";
import { SessionsWidget } from "../widgets/SessionsWidget";
import { VisibilityTreesWidget } from "../widgets/VisibilityTreesWidget";
import { MAIN_STAGE_ID } from "./MainFrontstage";

/** Widgets are provided (not hard-wired into the stage) so a Studio host can place them in its own frontstage. */
export const instanceGraphUiProvider: UiItemsProvider = {
  id: "InstanceGraph:Widgets",
  provideWidgets(stageId, _usage, location, section): Widget[] {
    if (stageId !== MAIN_STAGE_ID) return [];
    if (location === StagePanelLocation.Left && section === StagePanelSection.Start) {
      return [
        { id: "ig-seed", label: "Seed query", iconNode: <SvgSearch />, content: <SeedQueryWidget />, defaultState: WidgetState.Open, canPopout: false },
        { id: "ig-overview", label: "Overview", iconNode: <SvgList />, content: <OverviewWidget />, canPopout: false },
        { id: "ig-sessions", label: "Sessions", iconNode: <SvgSave />, content: <SessionsWidget />, canPopout: false },
      ];
    }
    if (location === StagePanelLocation.Left && section === StagePanelSection.End)
      return [
        { id: "ig-filters", label: "Traversal & filters", iconNode: <SvgFilter />, content: <FiltersWidget />, defaultState: WidgetState.Open, canPopout: false },
        { id: "ig-visibility", label: "Models & categories", iconNode: <SvgHierarchyTree />, content: <VisibilityTreesWidget />, canPopout: false },
      ];
    if (location === StagePanelLocation.Right && section === StagePanelSection.Start)
      return [
        { id: "ig-properties", label: "Properties", iconNode: <SvgInfo />, content: <PropertiesWidget />, defaultState: WidgetState.Open, canPopout: false },
        { id: SCHEMA_WIDGET_ID, label: "Schema", iconNode: <SvgPropertiesList />, content: <SchemaWidget />, canPopout: false },
        { id: "ig-geometry", label: "Geometry", iconNode: <SvgModel />, content: <GeometryWidget />, canPopout: false },
      ];
    if (location === StagePanelLocation.Right && section === StagePanelSection.End)
      return [{ id: "ig-legend", label: "Legend & colours", iconNode: <SvgPalette />, content: <LegendWidget />, defaultState: WidgetState.Open, canPopout: false }];
    return [];
  },
};
