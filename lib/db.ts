import { Pool, type QueryResult, type QueryResultRow } from "pg";
import type { Mug } from "./types";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mugs (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  series             TEXT,
  edition            TEXT,
  year               INTEGER,
  status             TEXT NOT NULL DEFAULT 'owned',
  condition          TEXT,
  condition_notes    TEXT,
  location           TEXT,
  acquired_date      DATE,
  price              NUMERIC,
  currency           TEXT,
  favorite           BOOLEAN NOT NULL DEFAULT FALSE,
  photo_url          TEXT,
  est_value_low      NUMERIC,
  est_value_high     NUMERIC,
  est_value_currency TEXT,
  notes              TEXT,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  ai_confidence      NUMERIC,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id         SERIAL PRIMARY KEY,
  mug_id     TEXT NOT NULL REFERENCES mugs(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  title      TEXT NOT NULL,
  price      NUMERIC,
  currency   TEXT,
  url        TEXT NOT NULL,
  image_url  TEXT,
  condition  TEXT,
  found_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (mug_id, url)
);

CREATE INDEX IF NOT EXISTS listings_mug_idx ON listings (mug_id);

CREATE TABLE IF NOT EXISTS catalog_mugs (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  series     TEXT,
  year       INTEGER,
  image_url  TEXT NOT NULL,
  source     TEXT,
  source_url TEXT,
  norm       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_norm_idx ON catalog_mugs (norm);
`;

let pool: Pool | null = null;
let schemaReady: Promise<unknown> | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) throw new Error("No database URL set (DATABASE_URL / POSTGRES_URL).");
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureSchema();
  return getPool().query<T>(text, params as never[]);
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = getPool().query(SCHEMA_SQL);
  await schemaReady;
}

/** Map a DB row (snake_case) to the camelCase Mug the client uses. */
export function rowToMug(r: Record<string, unknown>): Mug {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    name: (r.name as string) ?? "",
    series: (r.series as string) ?? null,
    edition: (r.edition as string) ?? null,
    year: r.year == null ? null : Number(r.year),
    status: (r.status as Mug["status"]) ?? "owned",
    condition: (r.condition as string) ?? null,
    conditionNotes: (r.condition_notes as string) ?? null,
    location: (r.location as string) ?? null,
    acquiredDate: r.acquired_date ? String(r.acquired_date).slice(0, 10) : null,
    price: r.price == null ? "" : Number(r.price),
    currency: (r.currency as string) ?? null,
    favorite: Boolean(r.favorite),
    photoUrl: (r.photo_url as string) ?? null,
    estValueLow: num(r.est_value_low),
    estValueHigh: num(r.est_value_high),
    estValueCurrency: (r.est_value_currency as string) ?? null,
    notes: (r.notes as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    aiConfidence: num(r.ai_confidence),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
    listings: Array.isArray(r.listings)
      ? (r.listings as Record<string, unknown>[]).map((l) => ({
          id: l.id as number,
          source: l.source as string,
          title: l.title as string,
          price: l.price == null ? null : Number(l.price),
          currency: (l.currency as string) ?? null,
          url: l.url as string,
          imageUrl: (l.image_url as string) ?? null,
          condition: (l.condition as string) ?? null,
          foundAt: l.found_at ? String(l.found_at) : undefined,
        }))
      : undefined,
  };
}
