export const IMODEL_EXTENSIONS: readonly string[] = ["bim", "ibim", "imodel"];

/** Why `path` cannot be opened as an iModel, judged by its name; undefined when it looks fine. */
export function iModelPathProblem(path: string): string | undefined {
  if (!path) return "No file was given.";
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext && IMODEL_EXTENSIONS.includes(ext) ? undefined
    : `${path.split(/[\\/]/).pop()} is not an iModel (expected ${IMODEL_EXTENSIONS.map((e) => `.${e}`).join(", ")}).`;
}
