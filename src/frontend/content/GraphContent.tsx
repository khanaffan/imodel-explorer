import { ClassGraphCanvas } from "../graph/ClassGraphCanvas";
import { GraphCanvas } from "../graph/GraphCanvas";
import { useClassGraphStore } from "../state/classGraphStore";

export function GraphContent() {
  const mode = useClassGraphStore((s) => s.mode);
  return mode === "classes" ? <ClassGraphCanvas /> : <GraphCanvas />;
}
