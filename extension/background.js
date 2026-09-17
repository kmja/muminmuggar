// Service worker: talks to Mukify (using the browser's existing session, via
// host permissions) and uploads the collection to Muminmuggar with the user's
// connection token. Nothing leaves the browser except the mug list.

const MUKIFY_ENDPOINT = "https://database-prod.mukify.com/graphiql/";
const API_BASE = "https://muminmuggar.vercel.app";

const QUERY = `query($type:Float,$first:Int!,$offset:Int!){collectionItem(type:$type,first:$first,offset:$offset){totalCount edges{node{boughtPrice boughtDate comment stickered signed misprinted item{nameEnUs basicInfo{name} additionalInfo{field rows{columns}}}}}}}`;
const ME_QUERY = `{me{currency}}`;

async function gql(query, variables) {
  const res = await fetch(MUKIFY_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error(json.errors[0].message || "Mukify error");
  return json.data;
}

async function fetchAll(type) {
  const out = [];
  let offset = 0, total = Infinity;
  while (offset < total) {
    const data = await gql(QUERY, { type, first: 100, offset });
    const conn = data.collectionItem;
    if (!conn) throw new Error("Not signed in to Mukify");
    total = conn.totalCount;
    const edges = conn.edges || [];
    out.push(...edges);
    offset += edges.length;
    if (!edges.length) break;
  }
  return out;
}

function normalise(node, wishlist) {
  const fields = {};
  for (const b of (node.item && node.item.additionalInfo) || [])
    for (const r of b.rows || [])
      for (const c of r.columns || []) (fields[b.field] = fields[b.field] || []).push(String(c));
  const serial = Number((fields.serial_number || [])[0]);
  return {
    serial: Number.isFinite(serial) ? serial : null,
    name: (node.item && ((node.item.basicInfo && node.item.basicInfo.name) || node.item.nameEnUs)) || null,
    wishlist: !!wishlist,
    boughtPrice: node.boughtPrice || null,
    boughtDate: node.boughtDate || null,
    comment: node.comment || null,
    stickered: !!node.stickered,
    signed: !!node.signed,
    misprinted: !!node.misprinted,
  };
}

async function getToken() {
  const { importToken } = await chrome.storage.local.get("importToken");
  return importToken || "";
}

async function runImport() {
  const token = await getToken();
  if (!token) throw new Error("NOT_CONNECTED");
  let currency = "SEK";
  try { const me = await gql(ME_QUERY, {}); currency = (me && me.me && me.me.currency) || currency; } catch { /* keep default */ }
  const owned = (await fetchAll(1)).map((n) => normalise(n, false));
  const wish = (await fetchAll(2)).map((n) => normalise(n, true));
  const res = await fetch(`${API_BASE}/api/import/mukify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-import-token": token },
    body: JSON.stringify({ items: owned.concat(wish), currency }),
  });
  let json = {};
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    if (res.status === 401) throw new Error("NOT_CONNECTED");
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "runImport") {
    runImport()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === "getStatus") {
    getToken().then((t) => sendResponse({ connected: !!t }));
    return true;
  }
});
