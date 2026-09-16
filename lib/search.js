/* Typo-tolerant search over mug records, backed by Fuse.js.
 *
 * Field values are folded (case/accent/punctuation-insensitive) before indexing,
 * so "gron" finds "Grön", "tooticky" finds "Too-Ticky", and "snohasten" finds
 * "Snöhäst". */

import Fuse from "fuse.js";

export const foldSearch = (s) =>
  (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/\bmumin/g, "moomin")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const OPTIONS = {
  threshold: 0.34, // 0 = exact, 1 = match anything
  ignoreLocation: true, // match anywhere in the string
  minMatchCharLength: 1,
  includeScore: true,
  shouldSort: true,
};

/**
 * Build a search over `items`. `fields` maps a Fuse key to a value getter; each
 * value is folded before indexing. Returns `(query) => items[]` (ranked), or all
 * items when the query is empty.
 */
export function createSearch(items, fields) {
  const keys = Object.keys(fields);
  const docs = items.map((item) => {
    const doc = { item };
    for (const key of keys) doc[key] = foldSearch(fields[key](item));
    return doc;
  });
  const fuse = new Fuse(docs, { keys, ...OPTIONS });
  return (query) => {
    const q = foldSearch(query);
    if (!q) return items;
    return fuse.search(q).map((r) => r.item);
  };
}
