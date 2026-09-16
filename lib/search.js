/* Lightweight fuzzy matching for mug names — tolerates hyphens, spacing,
 * diacritics, partial words and small typos (e.g. "Tooticky" ~ "Too-Ticky",
 * "snohasten" ~ "Snöhäst"). Used by every search box in the app. */

export const foldSearch = (s) =>
  (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/\bmumin/g, "moomin")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const threshold = (len) => (len <= 4 ? 1 : len <= 7 ? 2 : 3);

/**
 * Score 0 (no match) .. 1 (exact). Every query token must match some word of the
 * text — exactly, as a prefix/substring, or within a small edit distance.
 */
export function fuzzyScore(query, ...texts) {
  const q = foldSearch(query);
  if (!q) return 1;
  const words = foldSearch(texts.filter(Boolean).join(" ")).split(" ").filter(Boolean);
  const qts = q.split(" ").filter(Boolean);
  let total = 0;
  for (const qt of qts) {
    let best = 0;
    for (const w of words) {
      if (w === qt) { best = 1; break; }
      if (w.startsWith(qt)) best = Math.max(best, 0.9);
      else if (w.includes(qt)) best = Math.max(best, 0.8);
      else { const d = lev(qt, w); if (d <= threshold(qt.length)) best = Math.max(best, 0.6 - d * 0.05); }
    }
    if (!best) return 0;
    total += best;
  }
  return total / qts.length;
}

export const fuzzyMatch = (query, ...texts) => fuzzyScore(query, ...texts) > 0;
