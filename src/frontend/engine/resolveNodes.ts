import type { ClassRegistry } from "./ClassRegistry";
import { buildAspectResolveQuery, buildElementResolveQuery, buildModelResolveQuery, ID_LIST_CHUNK } from "./ecsql";
import { type GraphNode, type NodeKey, nodeKeyString } from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";

export type ResolvedNode = Omit<GraphNode, "depth" | "expanded">;

function shortClass(fullName: string) {
  return fullName.split(":")[1] ?? fullName;
}

/** Turns keys into display nodes with batched id-list queries (one per instance kind), plus a
 * cached lookup of model names. */
export class NodeResolver {
  private readonly _modelNames = new Map<string, string>();

  public constructor(private readonly _port: IModelQueryPort, private readonly _registry: ClassRegistry) { }

  public async resolve(keys: readonly NodeKey[]): Promise<Map<string, ResolvedNode>> {
    const byKind = { element: [] as NodeKey[], model: [] as NodeKey[], aspect: [] as NodeKey[], other: [] as NodeKey[] };
    for (const k of keys)
      byKind[this._registry.kindOf(k.classId)].push(k);

    const out = new Map<string, ResolvedNode>();
    const base = (k: NodeKey, label?: string, modelId?: string): ResolvedNode => {
      const className = this._registry.nameOf(k.classId);
      return {
        key: nodeKeyString(k),
        id: k.id,
        classId: k.classId,
        className,
        schemaName: className.split(":")[0],
        label: label || `${shortClass(className)} ${k.id}`,
        category: this._registry.categoryOf(k.classId),
        classHierarchy: this._registry.hierarchyOf(k.classId),
        modelId,
      };
    };

    const lookup = (ks: NodeKey[], build: (ids: string[]) => string) => this._queryIds([...new Set(ks.map((k) => k.id))], build);
    const [elements, models, aspects] = await Promise.all([
      lookup(byKind.element, buildElementResolveQuery),
      lookup(byKind.model, buildModelResolveQuery),
      lookup(byKind.aspect, buildAspectResolveQuery),
    ]);

    const elementRows = new Map(elements.map((r) => [`${r.ClassId}:${r.Id}`, r]));
    const modelIds = new Set<string>();
    for (const k of byKind.element) {
      const r = elementRows.get(nodeKeyString(k));
      if (r?.ModelId) modelIds.add(r.ModelId);
    }
    for (const r of models)
      this._modelNames.set(r.Id, r.UserLabel ?? r.CodeValue ?? `Model ${r.Id}`);
    await this._ensureModelNames([...modelIds]);

    for (const k of byKind.element) {
      const r = elementRows.get(nodeKeyString(k));
      const node = base(k, r?.UserLabel ?? r?.CodeValue, r?.ModelId);
      out.set(node.key, { ...node, modelName: node.modelId ? this._modelNames.get(node.modelId) : undefined });
    }
    const modelRows = new Map(models.map((r) => [`${r.ClassId}:${r.Id}`, r]));
    for (const k of byKind.model) {
      const r = modelRows.get(nodeKeyString(k));
      const node = base(k, r ? (r.UserLabel ?? r.CodeValue) : undefined);
      out.set(node.key, node);
    }
    const aspectRows = new Map(aspects.map((r) => [`${r.ClassId}:${r.Id}`, r]));
    for (const k of byKind.aspect) {
      const r = aspectRows.get(nodeKeyString(k));
      const node = base(k, r ? `${shortClass(this._registry.nameOf(k.classId))} of ${r.ElementId}` : undefined);
      out.set(node.key, node);
    }
    for (const k of byKind.other) {
      const node = base(k);
      out.set(node.key, node);
    }
    return out;
  }

  public modelName(modelId: string): string | undefined {
    return this._modelNames.get(modelId);
  }

  private async _ensureModelNames(ids: string[]) {
    const missing = ids.filter((id) => !this._modelNames.has(id));
    if (missing.length === 0)
      return;
    const rows = await this._queryIds(missing, buildModelResolveQuery);
    for (const r of rows)
      this._modelNames.set(r.Id, r.UserLabel ?? r.CodeValue ?? `Model ${r.Id}`);
  }

  private async _queryIds(ids: string[], build: (ids: string[]) => string) {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_LIST_CHUNK)
      chunks.push(ids.slice(i, i + ID_LIST_CHUNK));
    return (await Promise.all(chunks.map(async (c) => this._port.query(build(c))))).flat();
  }
}
