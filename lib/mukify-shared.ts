import { listMasterCatalog } from "./catalog";
import { createMug } from "./mugs";
import { ownKey, type MukifyImportResult } from "./mukify-import";
import type { Mug } from "./types";

/**
 * Import a Mukify collection from a user's **public username** — no bookmarklet,
 * no credentials. Mukify exposes a public `sharedCollectionItem` query; we match
 * each shared item to our catalogue by its item UUID, then create owned/wishlist
 * mugs. Only works when the user has enabled sharing for that collection.
 *
 * The public shared node carries no name/serial, so we first build a UUID→serial
 * index from Mukify's public catalogue (cached in-process for an hour).
 */

const ENDPOINT = "https://database-prod.mukify.com/graphiql/";

const CATALOG_QUERY = `query getGridItems($tagIds:[ID]!,$sortBy:String!,$priceMin:Float!,$priceMax:Float!,$yearMin:Float!,$yearMax:Float!,$first:Int,$offset:Int,$searched:String!,$currency:String){localizedFlatItem(tagIds:$tagIds,orderBy:$sortBy,priceGte:$priceMin,priceLte:$priceMax,manufacturingYearGte:$yearMin,manufacturingYearLte:$yearMax,first:$first,offset:$offset,searchString:$searched,currency:$currency){totalCount edges{node{idi uuid additionalInfo{field rows{columns}}}}}}`;

const SHARED_QUERY = `query($u:String!,$t:String!,$first:Int!,$offset:Int!){sharedCollectionItem(publicUsername:$u,collectionType:$t,first:$first,offset:$offset){totalCount shared edges{node{item{uuid idi}}}}}`;

async function gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || "Mukify error");
  return json.data as T;
}

type Index = { at: number; byUuid: Map<string, number>; byIdi: Map<number, number> };
let indexCache: Index | null = null;
const INDEX_TTL = 60 * 60 * 1000;

/** Mukify item UUID/idi → our catalogue serial number (num). */
export async function mukifyIndex(): Promise<Index> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache;
  const byUuid = new Map<string, number>();
  const byIdi = new Map<number, number>();
  const base = { tagIds: [], sortBy: "", priceMin: 0, priceMax: 1000000, yearMin: 1900, yearMax: 2030, searched: "", currency: "EUR" };
  let offset = 0, total = Infinity;
  while (offset < total) {
    const data = await gql(CATALOG_QUERY, { ...base, first: 100, offset });
    const conn = data.localizedFlatItem;
    total = conn.totalCount;
    const edges = conn.edges || [];
    for (const e of edges) {
      const n = e.node;
      const fields: Record<string, string[]> = {};
      for (const b of n.additionalInfo || []) for (const r of b.rows || []) for (const c of r.columns || []) (fields[b.field] = fields[b.field] || []).push(String(c));
      if ((fields.product_category || [])[0] !== "Moomin Mug") continue;
      const serial = Number((fields.serial_number || [])[0]);
      if (!Number.isFinite(serial)) continue;
      if (n.uuid) byUuid.set(String(n.uuid), serial);
      if (n.idi != null) byIdi.set(Number(n.idi), serial);
    }
    offset += edges.length;
    if (!edges.length) break;
  }
  indexCache = { at: Date.now(), byUuid, byIdi };
  return indexCache;
}

export interface MukifySharedResult extends MukifyImportResult {
  shared: boolean;
}

/** Import a public Mukify collection/wishlist by username ("1" = collection, "2" = wishlist). */
export async function importFromMukifyUser(
  username: string,
  owner: string,
  existing: Mug[],
  types: string[] = ["1", "2"],
): Promise<MukifySharedResult> {
  const { byUuid, byIdi } = await mukifyIndex();
  const catalog = await listMasterCatalog();
  const byNum = new Map(catalog.map((e) => [e.num, e]));
  const seen = new Set(existing.map((m) => ownKey(m.name)).filter(Boolean));
  const result: MukifySharedResult = { total: 0, created: 0, skipped: 0, unmatched: 0, names: [], shared: false };

  for (const type of types) {
    let offset = 0, total = Infinity;
    while (offset < total) {
      const data = await gql(SHARED_QUERY, { u: username, t: type, first: 100, offset });
      const conn = data.sharedCollectionItem;
      if (!conn) break;
      if (conn.shared) result.shared = true;
      total = conn.totalCount;
      const edges = conn.edges || [];
      for (const e of edges) {
        result.total++;
        const item = e.node?.item || {};
        const num = item.uuid != null && byUuid.has(String(item.uuid))
          ? byUuid.get(String(item.uuid))
          : item.idi != null ? byIdi.get(Number(item.idi)) : undefined;
        const entry = num != null ? byNum.get(num) : null;
        if (!entry) { result.unmatched++; continue; }
        const key = ownKey(entry.nameEn);
        if (key && seen.has(key)) { result.skipped++; continue; }
        await createMug({
          name: entry.nameEn,
          series: "Arabia Moomin",
          year: entry.year,
          status: type === "2" ? "wishlist" : "owned",
          photoUrl: entry.image,
          estValueLow: entry.estLow,
          estValueHigh: entry.estHigh,
          estValueCurrency: entry.estCur,
        }, owner);
        if (key) seen.add(key);
        result.created++;
        if (result.names.length < 8) result.names.push(entry.nameEn);
      }
      offset += edges.length;
      if (!edges.length) break;
    }
  }
  return result;
}
