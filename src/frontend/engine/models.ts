import type { ClassRegistry } from "./ClassRegistry";
import type { IModelQueryPort } from "./IModelQueryPort";

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly className: string;
  /** The model that contains this model's modeled element; undefined for the RepositoryModel. */
  readonly parentId?: string;
}

export interface ModelTreeNode {
  readonly model: ModelInfo;
  readonly children: readonly ModelTreeNode[];
}

/** Every model with its parent model: a sub-model's parent is the model containing the element it
 * breaks down (for example a DefinitionContainer's DefinitionModel, or a Drawing's DrawingModel). */
export async function loadModels(port: IModelQueryPort, registry: ClassRegistry): Promise<ModelInfo[]> {
  const rows = await port.query(
    "SELECT m.ECInstanceId Id, m.ECClassId ClassId, p.CodeValue Code, p.UserLabel UserLabel, p.Model.Id ParentId FROM bis.Model m LEFT JOIN bis.Element p ON p.ECInstanceId = m.ModeledElement.Id");
  return rows
    .map((r) => {
      const id = r.Id as string;
      const parent = r.ParentId as string | undefined;
      return { id, name: (r.UserLabel ?? r.Code ?? id) as string, className: registry.nameOf(r.ClassId), parentId: parent && parent !== id ? parent : undefined };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Nests models under their parents. Models whose parent is unknown become roots; cycles are broken. */
export function buildModelTree(models: readonly ModelInfo[]): ModelTreeNode[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const children = new Map<string | undefined, ModelInfo[]>();
  for (const m of models) {
    let parent = m.parentId !== undefined && byId.has(m.parentId) ? m.parentId : undefined;
    // A cycle would make every member unreachable from a root; attach the first member seen as a root.
    for (let p = parent, seen = new Set([m.id]); p !== undefined; p = byId.get(p)?.parentId) {
      if (seen.has(p)) { parent = undefined; break; }
      seen.add(p);
    }
    const list = children.get(parent) ?? [];
    list.push(m);
    children.set(parent, list);
  }
  const build = (m: ModelInfo): ModelTreeNode => ({ model: m, children: (children.get(m.id) ?? []).map(build) });
  return (children.get(undefined) ?? []).map(build);
}
