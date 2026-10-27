import { useActiveViewport } from "@itwin/appui-react";
import { IModelApp, type IModelConnection } from "@itwin/core-frontend";
import { Input, Select, Text } from "@itwin/itwinui-react";
import {
  CategoriesTreeComponent, ClassificationsTreeComponent, ModelsTreeComponent, TreeWidgetContextProvider,
} from "@itwin/tree-widget-react";
import { useEffect, useState } from "react";
import { useGraphStore } from "../state/graphStore";
import { getUnifiedSelectionStorage, syncTreeSelectionToGraph } from "../state/selectionStorage";

interface ClassificationSystem { code: string; count: number }
type TreeKind = "models" | "categories" | "classifications";

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
  const [tree, setTree] = useState<TreeKind>("models");
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    setSystems(undefined);
    setSystemCode(undefined);
    setTree("models");
    setSearchText("");
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

  if (!connection || !viewport) return <div className="ig-empty"><Text isMuted>Waiting for the 3D view…</Text></div>;
  const selectionStorage = getUnifiedSelectionStorage();
  const options: Array<{ value: TreeKind; label: string }> = [
    { value: "models", label: "Models" },
    { value: "categories", label: "Categories" },
    ...(systems?.length ? [{ value: "classifications" as const, label: "Classifications" }] : []),
  ];
  const content = tree === "models"
    ? <ModelsTreeComponent treeLabel="Models" searchText={searchText} selectionStorage={selectionStorage} selectionMode="single" />
    : tree === "categories"
      ? <CategoriesTreeComponent treeLabel="Categories" searchText={searchText} selectionStorage={selectionStorage} selectionMode="single" />
      : (
        <div className="ig-classifications">
          {systems && systems.length > 1 && (
            <Select size="small" value={systemCode} onChange={setSystemCode}
              options={systems.map((s) => ({ value: s.code, label: `${s.code} (${s.count})` }))} />
          )}
          {systemCode && (
            <ClassificationsTreeComponent key={systemCode} treeLabel="Classifications" searchText={searchText}
              selectionStorage={selectionStorage} selectionMode="single"
              hierarchyConfig={{ rootClassificationSystemCode: systemCode }}
              emptyTreeContent={<Text isMuted>No classifications in “{systemCode}”.</Text>} />
          )}
        </div>
      );

  return (
    <TreeWidgetContextProvider localization={IModelApp.localization}>
      <div className="ig-visibility-trees">
        <div className="ig-visibility-trees__header">
          <Select<TreeKind> size="small" value={tree} options={options} triggerProps={{ "aria-label": "Tree type" }}
            onChange={(value) => { setTree(value); setSearchText(""); }} />
          <Input size="small" aria-label={`Search ${tree}`} placeholder="Search…" value={searchText}
            onChange={(event) => setSearchText(event.target.value)} />
        </div>
        <div className="ig-visibility-trees__content">{content}</div>
      </div>
    </TreeWidgetContextProvider>
  );
}
