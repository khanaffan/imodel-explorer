import type { GraphData } from "../engine/GraphModel";

/** Keys of displayed instances whose label, class or id contains `query` (case-insensitive),
 * nearest to the centre first. Relationship groups (+N) are not instances and never match. */
export function findMatches(graph: GraphData, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [...graph.nodes.values()]
    .filter((n) => !n.aggregate && [n.label, n.className, n.id].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label))
    .map((n) => n.key);
}
