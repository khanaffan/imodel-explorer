import { QueryBinder } from "@itwin/core-common";
import type { ScreenViewport } from "@itwin/core-frontend";
import { graphActions, useGraphStore } from "../state/graphStore";
import { isGraphSelection } from "../state/selectionStorage";

let viewport: ScreenViewport | undefined;
/** Set while the graph writes the selection set, so the resulting event is not echoed back. */
let applyingFromGraph = false;
let unsubscribers: Array<() => void> = [];

function isGeometric(category: string | undefined) {
  return category === "geometric3d" || category === "geometric2d";
}

/** Two-way link between graph selection and the iModel selection set:
 * graph → viewport hilites (and optionally zooms to) geometric elements;
 * viewport → graph recentres on a single picked element. */
export const viewportSync = {
  attach(vp: ScreenViewport): void {
    viewportSync.detach();
    viewport = vp;
    const imodel = vp.iModel;

    unsubscribers.push(useGraphStore.subscribe((s, prev) => {
      if (s.selection === prev.selection && s.graph === prev.graph) return;
      const node = s.selection?.kind === "node" ? s.graph.nodes.get(s.selection.key) : undefined;
      const want = node && isGeometric(node.category) ? node.id : undefined;
      const current = imodel.selectionSet.elements;
      if (want ? current.size === 1 && current.has(want) : current.size === 0) return;
      applyingFromGraph = true;
      try {
        if (want) imodel.selectionSet.replace(want);
        else imodel.selectionSet.emptyAll();
      } finally {
        applyingFromGraph = false;
      }
    }));

    unsubscribers.push(imodel.selectionSet.onChanged.addListener(async (ev) => {
      if (applyingFromGraph) return;
      const ids = [...ev.set.elements];
      if (ids.length !== 1) return;
      if (isGraphSelection(ids[0])) return;
      // A pick in the 3D view starts a new exploration, even when the element is already on the graph.
      const { graph } = useGraphStore.getState();
      const existing = [...graph.nodes.values()].find((n) => n.id === ids[0] && isGeometric(n.category));
      if (existing) {
        await graphActions.seedExternal({ id: existing.id, classId: existing.classId });
        return;
      }
      const reader = imodel.createQueryReader("SELECT ECClassId FROM bis.Element WHERE ECInstanceId = ?", QueryBinder.from([ids[0]]));
      for await (const row of reader) {
        await graphActions.seedExternal({ id: ids[0], classId: row[0] as string });
        break;
      }
    }));
  },

  detach(): void {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    viewport = undefined;
  },

  zoomTo(id: string): void {
    if (!viewport) return;
    void viewport.zoomToElements([id], { animateFrustumChange: true, marginPercent: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 } });
  },
};
