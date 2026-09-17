/**
 * Enrich the Moomin mug catalogue with collector attributes from Mukify
 * (https://mukify.com) — bottom stamps, stickers/tags, characters, colours,
 * designers, original illustrations, material and measurements.
 *
 * Mukify exposes a public GraphQL endpoint; we only read its public catalogue
 * (no login). Run with:  node scripts/enrich-mukify.mjs
 *
 * Writes lib/mug-details.json, keyed by our catalogue `num` (which matches
 * Mukify's "Moomin Mug" serial number). Kept separate from master-catalog.json
 * so the client bundle stays small.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENDPOINT = "https://database-prod.mukify.com/graphiql/";
const CATEGORY = "Moomin Mug";

const QUERY = `query getGridItems($tagIds:[ID]!,$numberChoices:String,$sortBy:String!,$priceMin:Float!,$priceMax:Float!,$yearMin:Float!,$yearMax:Float!,$first:Int,$offset:Int,$searched:String!,$key:String,$currency:String,$filterCollectionId:ID){localizedFlatItem(tagIds:$tagIds,numberChoices:$numberChoices,orderBy:$sortBy,priceGte:$priceMin,priceLte:$priceMax,manufacturingYearGte:$yearMin,manufacturingYearLte:$yearMax,first:$first,offset:$offset,searchString:$searched,key:$key,currency:$currency,filterCollectionId:$filterCollectionId){totalCount edges{node{seoUrlEn seoUrlSv basicInfo{name} additionalInfo{field rows{columns}}}}}}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset, first) {
  const variables = {
    tagIds: [], numberChoices: null, sortBy: "", priceMin: 0, priceMax: 1000000,
    yearMin: 1900, yearMax: 2030, first, offset, searched: "", key: null,
    currency: "EUR", filterCollectionId: null,
  };
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName: "getGridItems", query: QUERY, variables }),
      });
      const json = await res.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
      return json.data.localizedFlatItem;
    } catch (e) {
      console.error(`  offset ${offset} attempt ${attempt}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw new Error(`Mukify request failed at offset ${offset}`);
}

async function fetchAll() {
  const all = [];
  let offset = 0, total = null;
  do {
    const page = await fetchPage(offset, 100);
    total = page.totalCount;
    const edges = page.edges || [];
    all.push(...edges.map((e) => e.node));
    console.log(`  fetched ${all.length}/${total}`);
    offset += edges.length;
    if (!edges.length) break;
    await sleep(400);
  } while (offset < total);
  return all;
}

/** Flatten a node's `additionalInfo` blocks into { field: [values] }. */
function fieldsOf(node) {
  const out = {};
  for (const block of node.additionalInfo || []) {
    const values = (block.rows || []).flatMap((r) => (r.columns || []).map((c) => String(c).trim())).filter(Boolean);
    if (values.length) out[block.field] = (out[block.field] || []).concat(values);
  }
  return out;
}

/** "Height: 8.1, Width: 11.2, Diameter: 8.3 cm" -> { height: "8.1", width: "11.2", diameter: "8.3 cm" } */
function parseMeasurements(values = []) {
  const m = {};
  for (const v of values) {
    for (const part of String(v).split(",")) {
      const [label, val] = part.split(/:\s*/, 2);
      if (label && val) m[label.trim().toLowerCase()] = val.trim();
    }
  }
  return m;
}

/** Mukify sometimes packs several values into one cell ("Blue, Lilac"). */
const splitList = (values = []) => values.flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean);

function toDetails(node) {
  const f = fieldsOf(node);
  const first = (k) => (f[k] && f[k][0]) || null;
  return {
    mukifyNum: Number(first("serial_number")) || null,
    category: first("product_category"),
    aka: f.aka || [],
    theme: first("themes"),
    special: (f.themes || []).some((t) => /special/i.test(t)),
    stamps: f.stamps || [],
    stickers: f.stickers || [],
    characters: splitList(f.characters),
    colors: splitList(f.colors),
    itemDesigner: first("item_designers"),
    graphicDesigner: first("imagery_designers"),
    imagerySources: f.imagery_sources || [],
    material: first("materials"),
    measurements: parseMeasurements(f.measurements),
    urlEn: node.seoUrlEn ? `https://www.mukify.com/en/${node.seoUrlEn}` : null,
    urlSv: node.seoUrlSv ? `https://www.mukify.com/sv/${node.seoUrlSv}` : null,
  };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalogPath = join(here, "..", "lib", "master-catalog.json");
  const outPath = join(here, "..", "lib", "mug-details.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  console.log("Fetching Mukify catalogue…");
  const items = await fetchAll();
  const mugs = items.filter((it) => fieldsOf(it).product_category?.[0] === CATEGORY);
  console.log(`Mukify: ${items.length} items, ${mugs.length} ${CATEGORY}`);

  const byNum = new Map();
  for (const it of mugs) {
    const d = toDetails(it);
    if (d.mukifyNum) byNum.set(d.mukifyNum, d);
  }

  const details = {};
  let matched = 0;
  const unmatched = [];
  for (const e of catalog) {
    const d = byNum.get(e.num);
    if (d) { details[e.num] = d; matched++; }
    else unmatched.push(`${e.num}:${e.nameEn}`);
  }

  await writeFile(outPath, JSON.stringify(details, null, 1) + "\n");
  console.log(`\nWrote ${outPath}`);
  console.log(`Matched ${matched}/${catalog.length} catalogue entries to Mukify mugs.`);
  if (unmatched.length) console.log("Unmatched:", unmatched.join(", "));
  const withStamps = Object.values(details).filter((d) => d.stamps.length).length;
  const withStickers = Object.values(details).filter((d) => d.stickers.length).length;
  const specials = Object.values(details).filter((d) => d.special).length;
  console.log(`Attribute coverage: stamps ${withStamps}, stickers ${withStickers}, special editions ${specials}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
