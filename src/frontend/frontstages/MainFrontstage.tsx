import { type Frontstage, FrontstageUtilities, StagePanelState, StageUsage, StandardContentLayouts } from "@itwin/appui-react";
import { SvgClose } from "@itwin/itwinui-icons-react";
import { IconButton } from "@itwin/itwinui-react";
import { GraphContent } from "../content/GraphContent";
import { ViewportContent } from "../content/ViewportContent";

export const MAIN_STAGE_ID = "InstanceGraph:Main";

/** Graph on the left, 3D view on the right; widgets from {@link InstanceGraphUiProvider}. */
export function createMainFrontstage(onClose: () => void): Frontstage {
  return FrontstageUtilities.createStandardFrontstage({
    id: MAIN_STAGE_ID,
    usage: StageUsage.General,
    contentGroupProps: {
      id: "InstanceGraph:Content",
      layout: { ...StandardContentLayouts.twoVerticalSplit, verticalSplit: { id: "InstanceGraph:Split", percentage: 0.62, left: 0, right: 1, minSizeLeft: 300, minSizeRight: 200 } },
      contents: [
        { id: "graph", classId: "", content: <GraphContent /> },
        { id: "viewport", classId: "", content: <ViewportContent /> },
      ],
    },
    cornerButton: <IconButton styleType="borderless" label="Close iModel" onClick={onClose}><SvgClose /></IconButton>,
    leftPanelProps: { sizeSpec: 360, pinned: true, defaultState: StagePanelState.Open },
    rightPanelProps: { sizeSpec: 380, pinned: true, defaultState: StagePanelState.Open },
    bottomPanelProps: { sizeSpec: 200, pinned: false, defaultState: StagePanelState.Minimized },
    hideToolSettings: true,
  });
}
