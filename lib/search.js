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
  // Index the original items directly, folding each field via `getFn`. (Wrapping
  // items in `{ item, ...fields }` docs made Fuse return the wrapper, so callers
  // lost the real object — missing images, folded names, etc.)
  const keys = Object.keys(fields).map((key) => ({
    name: key,
    getFn: (item) => foldSearch(fields[key](item)),
  }));
  const fuse = new Fuse(items, { keys, ...OPTIONS });
  return (query) => {
    const q = foldSearch(query);
    if (!q) return items;
    return fuse.search(q).map((r) => r.item);
  };
}
