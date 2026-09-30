import { Fragment } from "react";
import type { ConstraintInfo } from "../engine/relationshipInfo";
import "./widgets.css";

/** One side of a relationship. Shared by the Properties and Schema widgets so they agree;
 * pass `onClassClick` to render constraint classes as links. */
export function Constraint({ title, c, onClassClick }: { title: string; c: ConstraintInfo; onClassClick?: (fullName: string) => void }) {
  const classLink = (name: string) => onClassClick
    ? <button className="ig-link" onClick={() => onClassClick(name)}>{name}</button>
    : name;
  return (
    <div className="ig-constraint">
      <div><b>{title}</b> <code>({c.multiplicity})</code> {c.roleLabel && <i>“{c.roleLabel}”</i>}</div>
      <div className="ig-card__sub">
        {c.classes.map((n, i) => <Fragment key={n}>{i > 0 && ", "}{classLink(n)}</Fragment>)}
        {c.polymorphic ? " (polymorphic)" : ""}
      </div>
      {onClassClick && c.abstractConstraint && <div className="ig-card__sub">Abstract constraint {classLink(c.abstractConstraint)}</div>}
    </div>
  );
}
