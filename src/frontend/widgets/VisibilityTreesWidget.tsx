import { useActiveViewport } from "@itwin/appui-react";
import { IModelApp, type IModelConnection } from "@itwin/core-frontend";
import { Select, Text } from "@itwin/itwinui-react";
import {
  CategoriesTreeComponent, ClassificationsTreeComponent, ModelsTreeComponent, type TreeDefinition, TreeWidgetComponent,
} from "@itwin/tree-widget-react";
import { useEffect, useMemo, useState } from "react";
import { useGraphStore } from "../state/graphStore";
import { getUnifiedSelectionStorage, syncTreeSelectionToGraph } from "../state/selectionStorage";

interface ClassificationSystem { code: string; count: number }

async function queryClassificationSystems(imodel: IModelConnection): Promise<ClassificationSystem[]> {
  const out: ClassificationSystem[] = [];
  try {
    const reader = imodel.createQueryReader(
      `SELECT s.CodeValue, (SELECT count(*) FROM ClassificationSystems.ElementHasClassifications r
         JOIN ClassificationSystems.Classification c ON c.ECInstanceId = r.TargetECInstanceId
         JOIN ClassificationSystems.ClassificationTable t ON t.ECInstanceId = c.Model.Id
         WHERE t.Parent.Id = s.ECInstanceId)
       FROM ClassificationSystems.ClassificationSystem s WHERE s.CodeValue IS NOT NULL ORDER BY s.CodeValue`);
    for await (const row of reader) out.push({ code: row[0] as string, count: Number(row[1]) });
  } catch {
    // Schema not present: the iModel has no classifications.
  }
  return out;
}

/** Models / Categories / Classifications trees (from @itwin/tree-widget-react) to show or hide what the 3D view displays. */
export function VisibilityTreesWidget() {
  const connection = useGraphStore((s) => s.connection);
  const viewport = useActiveViewport();
  const [systems, setSystems] = useState<ClassificationSystem[]>();
  const [systemCode, setSystemCode] = useState<string>();

  useEffect(() => {
    setSystems(undefined);
    setSystemCode(undefined);
    if (!connection) return;
    let live = true;
    void queryClassificationSystems(connection).then((s) => {
      if (!live) return;
      setSystems(s);
      setSystemCode([...s].sort((a, b) => b.count - a.count)[0]?.code);
    });
    const unsubscribe = syncTreeSelectionToGraph(connection);
    return () => { live = false; unsubscribe(); };
  }, [connection]);

  const trees = useMemo((): TreeDefinition[] => {
    const selectionStorage = getUnifiedSelectionStorage();
    const defs: TreeDefinition[] = [
      {
        id: ModelsTreeComponent.id,
        getLabel: ({ standardLabels }) => ModelsTreeComponent.getLabel({ standardLabels }),
        isSearchable: true,
        render: ({ treeLabel, searchText }) => (
          <ModelsTreeComponent treeLabel={treeLabel} searchText={searchText} selectionStorage={selectionStorage} selectionMode="single" />
        ),
      },
      {
        id: CategoriesTreeComponent.id,
        getLabel: ({ standardLabels }) => CategoriesTreeComponent.getLabel({ standardLabels }),
        isSearchable: true,
        render: ({ treeLabel, searchText }) => (
          <CategoriesTreeComponent treeLabel={treeLabel} searchText={searchText} selectionStorage={selectionStorage} selectionMode="single" />
        ),
      },
    ];
    if (systems && systems.length > 0) {
      defs.push({
        id: ClassificationsTreeComponent.id,
        getLabel: ({ standardLabels }) => ClassificationsTreeComponent.getLabel({ standardLabels }),
        isSearchable: true,
        render: ({ treeLabel, searchText }) => (
          <div className="ig-classifications">
            {systems.length > 1 && (
              <Select size="small" value={systemCode} onChange={setSystemCode}
                options={systems.map((s) => ({ value: s.code, label: `${s.code} (${s.count})` }))} />
            )}
            {systemCode && (
              <ClassificationsTreeComponent key={systemCode} treeLabel={treeLabel} searchText={searchText}
                selectionStorage={selectionStorage} selectionMode="single"
                hierarchyConfig={{ rootClassificationSystemCode: systemCode }}
                emptyTreeContent={<Text isMuted>No classifications in “{systemCode}”.</Text>} />
            )}
          </div>
        ),
      });
    }
    return defs;
  }, [systems, systemCode]);

  if (!connection || !viewport) return <div className="ig-empty"><Text isMuted>Waiting for the 3D view…</Text></div>;
  return (
    <div className="ig-visibility-trees">
      <TreeWidgetComponent trees={trees} localization={IModelApp.localization} />
    </div>
  );
}
