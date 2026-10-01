/** Scores `text` against `query` as a case-insensitive subsequence; higher is better, undefined
 * when not every query character appears in order. Rewards contiguous runs, word starts and an
 * early first match, so "fit" ranks "Fit to view" above "Find in graph…". */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  let first = -1;
  for (const ch of q) {
    if (ch === " ") { run = 0; continue; }
    const found = t.indexOf(ch, ti);
    if (found < 0) return undefined;
    if (first < 0) first = found;
    run = found === ti && found > 0 ? run + 1 : 0;
    const wordStart = found === 0 || /[\s\-_:./>(]/.test(t[found - 1]);
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 10;
  else if (t.includes(q)) score += 5;
  return score - Math.min(first, 10) * 0.1 - t.length * 0.01;
}
