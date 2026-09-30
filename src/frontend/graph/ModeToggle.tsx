import { ButtonGroup, Button } from "@itwin/itwinui-react";
import { classGraphActions, useClassGraphStore } from "../state/classGraphStore";

/** Switches the graph pane between instance-level and class-level ("observed schema") views. */
export function ModeToggle() {
  const mode = useClassGraphStore((s) => s.mode);
  return (
    <ButtonGroup>
      <Button size="small" styleType={mode === "instances" ? "high-visibility" : "default"} title="Instance graph" onClick={() => classGraphActions.setMode("instances")}>Instances</Button>
      <Button size="small" styleType={mode === "classes" ? "high-visibility" : "default"} title="Class-level graph: which classes relate to which, and how often" onClick={() => classGraphActions.setMode("classes")}>Classes</Button>
    </ButtonGroup>
  );
}
