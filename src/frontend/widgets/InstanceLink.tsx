import { Id64 } from "@itwin/core-bentley";
import type { ReactNode } from "react";
import type { InstanceReference } from "../engine/instanceProperties";
import { graphActions } from "../state/graphStore";

export function InstanceLink({ reference, children }: { reference: InstanceReference; children?: ReactNode }) {
  const label = children ?? reference.id;
  if (!Id64.isValidId64(reference.id)) return <>{label}</>;
  return <button
    className="ig-link"
    data-instance-id={reference.id}
    title={`Centre graph on ${reference.targetBaseClass ?? "instance"} ${reference.id}`}
    onClick={(event) => { event.stopPropagation(); void graphActions.centreOnReference(reference); }}
  >{label}</button>;
}
