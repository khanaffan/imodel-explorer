import type { SchemaView } from "@itwin/ecschema-metadata";
import { buildClassCatalogQuery } from "./ecsql";
import type { NodeCategory } from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";

type ViewClass = SchemaView.Class;

/** Maps class ids to names and answers IS-A / category questions. Built once per connection from
 * `meta.ECClassDef` plus the frontend `SchemaView` (no ECSchemaRpcInterface needed). */
export class ClassRegistry {
  private readonly _hierarchy = new Map<string, readonly string[]>();
  private readonly _category = new Map<string, NodeCategory>();

  private constructor(
    public readonly view: SchemaView,
    private readonly _names: ReadonlyMap<string, string>,
    private readonly _ids: ReadonlyMap<string, string>,
  ) { }

  public static async create(port: IModelQueryPort): Promise<ClassRegistry> {
    const [view, rows] = await Promise.all([port.getSchemaView(), port.query(buildClassCatalogQuery())]);
    const names = new Map<string, string>();
    const ids = new Map<string, string>();
    for (const row of rows) {
      const fullName = `${row.SchemaName}:${row.ClassName}`;
      names.set(row.Id, fullName);
      ids.set(fullName.toLowerCase(), row.Id);
    }
    return new ClassRegistry(view, names, ids);
  }

  public nameOf(classId: string): string {
    return this._names.get(classId) ?? `Unknown:${classId}`;
  }

  public idOf(fullName: string): string | undefined {
    return this._ids.get(fullName.replace(".", ":").toLowerCase());
  }

  public allClassNames(): string[] {
    return [...this._names.values()].sort();
  }

  public findClass(fullName: string): ViewClass | undefined {
    return this.view.findClass(fullName);
  }

  /** The class itself followed by every base class and mixin, nearest first. */
  public hierarchyOf(classId: string): readonly string[] {
    let result = this._hierarchy.get(classId);
    if (result)
      return result;
    const name = this.nameOf(classId);
    const cls = this.findClass(name);
    const seen = new Set<string>([name]);
    const out = [name];
    const queue: ViewClass[] = cls ? [cls] : [];
    while (queue.length > 0) {
      const c = queue.shift()!;
      for (const next of [c.baseClass, ...c.mixins]) {
        if (next && !seen.has(next.fullName)) {
          seen.add(next.fullName);
          out.push(next.fullName);
          queue.push(next);
        }
      }
    }
    result = out;
    this._hierarchy.set(classId, result);
    return result;
  }

  public isA(classId: string, baseFullName: string): boolean {
    const target = baseFullName.replace(".", ":").toLowerCase();
    return this.hierarchyOf(classId).some((n) => n.toLowerCase() === target);
  }

  public categoryOf(classId: string): NodeCategory {
    let cat = this._category.get(classId);
    if (cat)
      return cat;
    const is = (n: string) => this.isA(classId, n);
    if (is("BisCore:GeometricElement3d")) cat = "geometric3d";
    else if (is("BisCore:GeometricElement2d")) cat = "geometric2d";
    else if (is("BisCore:DefinitionElement")) cat = "definition";
    else if (is("BisCore:RoleElement")) cat = "role";
    else if (is("BisCore:InformationContentElement")) cat = "information";
    else if (is("BisCore:Model")) cat = "model";
    else if (is("BisCore:ElementAspect")) cat = "aspect";
    else cat = "other";
    this._category.set(classId, cat);
    return cat;
  }

  public kindOf(classId: string): "element" | "model" | "aspect" | "other" {
    if (this.isA(classId, "BisCore:Element")) return "element";
    if (this.isA(classId, "BisCore:Model")) return "model";
    if (this.isA(classId, "BisCore:ElementAspect")) return "aspect";
    return "other";
  }
}
