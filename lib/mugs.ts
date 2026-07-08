import { randomBytes } from "crypto";
import { query, rowToMug } from "./db";
import type { Mug } from "./types";

export function newId(): string {
  return `${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
}

const numOrNull = (v: unknown) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const dateOrNull = (v: unknown) => {
  const s = v ? String(v).slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export async function listMugs(): Promise<Mug[]> {
  const { rows } = await query(
    `SELECT m.*,
       COALESCE(
         (SELECT json_agg(l ORDER BY l.found_at DESC)
          FROM listings l WHERE l.mug_id = m.id),
         '[]'
       ) AS listings
     FROM mugs m
     ORDER BY m.updated_at DESC`,
  );
  return rows.map(rowToMug);
}

export async function getMug(id: string): Promise<Mug | null> {
  const { rows } = await query(
    `SELECT m.*, COALESCE((SELECT json_agg(l ORDER BY l.found_at DESC) FROM listings l WHERE l.mug_id = m.id), '[]') AS listings
     FROM mugs m WHERE m.id = $1`,
    [id],
  );
  return rows[0] ? rowToMug(rows[0]) : null;
}

export async function createMug(d: Partial<Mug>): Promise<Mug> {
  const id = d.id || newId();
  const { rows } = await query(
    `INSERT INTO mugs
      (id, name, series, edition, year, status, condition, condition_notes, location,
       acquired_date, price, currency, favorite, photo_url, est_value_low, est_value_high,
       est_value_currency, notes, tags, ai_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      id,
      strOrNull(d.name) ?? "",
      strOrNull(d.series),
      strOrNull(d.edition),
      numOrNull(d.year),
      d.status || "owned",
      strOrNull(d.condition),
      strOrNull(d.conditionNotes),
      strOrNull(d.location),
      dateOrNull(d.acquiredDate),
      numOrNull(d.price),
      strOrNull(d.currency),
      Boolean(d.favorite),
      strOrNull(d.photoUrl),
      numOrNull(d.estValueLow),
      numOrNull(d.estValueHigh),
      strOrNull(d.estValueCurrency),
      strOrNull(d.notes),
      Array.isArray(d.tags) ? d.tags : [],
      numOrNull(d.aiConfidence),
    ],
  );
  return rowToMug(rows[0]);
}

const COLS: Record<string, (v: unknown) => unknown> = {
  name: (v) => strOrNull(v) ?? "",
  series: strOrNull,
  edition: strOrNull,
  year: numOrNull,
  status: (v) => String(v || "owned"),
  condition: strOrNull,
  condition_notes: strOrNull,
  location: strOrNull,
  acquired_date: dateOrNull,
  price: numOrNull,
  currency: strOrNull,
  favorite: (v) => Boolean(v),
  photo_url: strOrNull,
  est_value_low: numOrNull,
  est_value_high: numOrNull,
  est_value_currency: strOrNull,
  notes: strOrNull,
  tags: (v) => (Array.isArray(v) ? v : []),
  ai_confidence: numOrNull,
};
const CAMEL_TO_COL: Record<string, string> = {
  name: "name", series: "series", edition: "edition", year: "year", status: "status",
  condition: "condition", conditionNotes: "condition_notes", location: "location",
  acquiredDate: "acquired_date", price: "price", currency: "currency", favorite: "favorite",
  photoUrl: "photo_url", estValueLow: "est_value_low", estValueHigh: "est_value_high",
  estValueCurrency: "est_value_currency", notes: "notes", tags: "tags", aiConfidence: "ai_confidence",
};

export async function updateMug(id: string, patch: Record<string, unknown>): Promise<Mug | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    const col = CAMEL_TO_COL[k];
    if (!col || !COLS[col]) continue;
    sets.push(`${col} = $${i++}`);
    vals.push(COLS[col](v));
  }
  if (!sets.length) return getMug(id);
  sets.push(`updated_at = now()`);
  vals.push(id);
  const { rows } = await query(`UPDATE mugs SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
  return rows[0] ? rowToMug(rows[0]) : null;
}

export async function deleteMug(id: string): Promise<void> {
  await query("DELETE FROM mugs WHERE id = $1", [id]);
}
