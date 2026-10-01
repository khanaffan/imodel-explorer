/** Placeholder rows shaped like the content being loaded; `label` is announced to screen readers. */
export function Skeleton({ label, rows = 4, twoLine = false }: { label: string; rows?: number; twoLine?: boolean }) {
  return (
    <div className="ig-skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ig-skeleton__row">
          <span className="ig-skeleton__bar" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
          {twoLine && <span className="ig-skeleton__bar ig-skeleton__bar--sub" style={{ width: `${30 + ((i * 23) % 30)}%` }} />}
        </div>
      ))}
    </div>
  );
}
