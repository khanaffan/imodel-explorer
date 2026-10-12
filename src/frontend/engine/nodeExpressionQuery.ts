import type { ClassRegistry } from "./ClassRegistry";
import { ID_LIST_CHUNK, buildExpressionPropertyQuery } from "./ecsql";
import { nodeKeyString, type GraphNode } from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";
import { evaluateExpression, expressionProperties, type NodeExpr, type Scalar } from "./nodeExpression";
import type { ResolvedNode } from "./resolveNodes";
import { TraversalCancelled, type CancelToken } from "./GraphEngine";

/** Fetch each property independently: a missing $-> property removes the entire row in ECSQL. */
export async function matchingExpressionNodes(
  port: IModelQueryPort, registry: ClassRegistry, expression: NodeExpr,
  nodes: ReadonlyMap<string, ResolvedNode | GraphNode>, cancel?: CancelToken,
): Promise<Set<string>> {
  const properties = expressionProperties(expression).filter((p) => !/^(ECInstanceId|ECClassId)$/i.test(p));
  const values = new Map<string, Record<string, Scalar>>();
  const classes = new Map<string, Array<ResolvedNode | GraphNode>>();
  for (const node of nodes.values()) {
    if (node.aggregate) continue;
    // Concrete classes preserve identities across element/model/aspect tables and support other entities.
    if (!classes.has(node.className)) classes.set(node.className, []);
    classes.get(node.className)!.push(node);
  }
  for (const [className, candidates] of classes) {
    const cls = registry.findClass(className);
    for (const prop of properties) {
      const [name, member] = prop.split(".");
      const metadata = cls?.getProperty(name);
      if (!metadata) continue;
      if (member ? !metadata.isNavigation() : !metadata.isPrimitive() || metadata.isArray())
        throw new Error(`Unsupported EC property: ${className}.${prop}`);
      for (let i = 0; i < candidates.length; i += ID_LIST_CHUNK) {
        if (cancel?.cancelled) throw new TraversalCancelled();
        const batch = candidates.slice(i, i + ID_LIST_CHUNK);
        const rows = await port.query(buildExpressionPropertyQuery(className, prop, batch.map((n) => n.id)));
        if (cancel?.cancelled) throw new TraversalCancelled();
        for (const row of rows) {
          const key = nodeKeyString({ classId: row.ClassId, id: row.Id });
          if (!nodes.has(key)) continue;
          const v: unknown = row.V;
          if (v !== undefined && v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")
            throw new Error(`Unsupported property value: ${className}.${prop}`);
          if (!values.has(key)) values.set(key, {});
          values.get(key)![prop] = v ?? null;
        }
      }
    }
  }
  return new Set([...nodes].filter(([key, node]) => evaluateExpression(expression, node, values.get(key)) === true).map(([key]) => key));
}
