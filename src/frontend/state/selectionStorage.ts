import { QueryBinder } from "@itwin/core-common";
import { IModelConnection } from "@itwin/core-frontend";
import { createStorage, Selectable, Selectables, type SelectionStorage } from "@itwin/unified-selection";
import { graphActions } from "./graphStore";

let storage: SelectionStorage | undefined;

/** One unified selection storage for the app, used by the models / categories / classifications trees. */
export function getUnifiedSelectionStorage(): SelectionStorage {
  if (!storage) {
    const created = createStorage();
    IModelConnection.onClose.addListener((imodel) => created.clearStorage({ imodelKey: imodel.key }));
    storage = created;
  }
  return storage;
}

const CLASS_NAME = /^\w+[.:]\w+$/;

/** Recentres the graph when a single instance is picked in one of the trees. Returns an unsubscribe function. */
export function syncTreeSelectionToGraph(imodel: IModelConnection): () => void {
  return getUnifiedSelectionStorage().selectionChangeEvent.addListener(async (args) => {
    if (args.imodelKey !== imodel.key || args.level !== 0 || (args.changeType !== "replace" && args.changeType !== "add")) return;
    const keys: { className: string; id: string }[] = [];
    Selectables.forEach(args.selectables, (s) => { if (Selectable.isInstanceKey(s)) keys.push(s); });
    if (keys.length !== 1 || !CLASS_NAME.test(keys[0].className)) return;
    const { id, className } = keys[0];
    const reader = imodel.createQueryReader(`SELECT ECClassId FROM ${className.replace(":", ".")} WHERE ECInstanceId = ?`, QueryBinder.from([id]));
    for await (const row of reader) {
      await graphActions.showInstance({ id, classId: row[0] as string });
      break;
    }
  });
}
