// Local labeling tool. Point it at a folder of real mug photos; it precomputes
// the model's top-4 for each, serves a review page that mirrors the app's match
// picker, and writes your picks to labels.jsonl.
//
//   npm run label -- /path/to/photos          (default: ./label-images)
//
// Then open http://localhost:8787 and click through. Keys: 1-4 pick, N none/search,
// ←/→ navigate.
import http from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createMatcher, ROOT } from "./lib/model.mjs";

const folder = path.resolve(process.argv[2] || "label-images");
const PORT = Number(process.env.PORT || 8787);
const OUT = path.join(ROOT, "labels.jsonl");
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".avif", ".tif", ".tiff", ".bmp"]);

if (!existsSync(folder)) { console.error(`No such folder: ${folder}`); process.exit(1); }
const files = (await readdir(folder)).filter((f) => EXTS.has(path.extname(f).toLowerCase())).sort();
if (!files.length) { console.error(`No images in ${folder}`); process.exit(1); }

const catalog = JSON.parse(await readFile(path.join(ROOT, "lib/master-catalog.json"), "utf8"));
const { embed, rank, b64 } = await createMatcher();

console.log(`Embedding ${files.length} images from ${folder}…`);
const items = [];
for (let i = 0; i < files.length; i++) {
  const x = await embed(path.join(folder, files[i]));
  items.push({ file: files[i], embedding: b64(x), candidates: rank(x, 4).map((c) => c.num) });
  process.stdout.write(`\r  ${i + 1}/${files.length}`);
}
process.stdout.write("\n");

const labels = new Map(); // file -> { chosenNum, chosenName, ts }

async function persist() {
  const lines = [];
  for (const it of items) {
    const l = labels.get(it.file);
    if (!l) continue;
    lines.push(JSON.stringify({ file: it.file, chosenNum: l.chosenNum, chosenName: l.chosenName, candidates: it.candidates, embedding: it.embedding, ts: l.ts }));
  }
  await writeFile(OUT, lines.length ? lines.join("\n") + "\n" : "");
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp" };
const send = (res, code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
async function sendFile(res, file) {
  try { const buf = await readFile(file); res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" }); res.end(buf); }
  catch { send(res, 404, "text/plain", "not found"); }
}
const readBody = (req) => new Promise((ok, err) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => ok(s)); req.on("error", err); });

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  try {
    if (p === "/") return send(res, 200, "text/html; charset=utf-8", HTML);
    if (p === "/data") return send(res, 200, "application/json", JSON.stringify({ total: items.length, items: items.map(({ file, candidates }) => ({ file, candidates })) }));
    if (p === "/catalog") return send(res, 200, "application/json", JSON.stringify(catalog.map((e) => ({ num: e.num, nameEn: e.nameEn, nameSv: e.nameSv, year: e.year, image: e.image }))));
    if (p === "/status") return send(res, 200, "application/json", JSON.stringify({ total: items.length, labeled: labels.size }));
    if (p.startsWith("/photo/")) {
      const i = Number(p.slice(7));
      if (!Number.isInteger(i) || i < 0 || i >= items.length) return send(res, 404, "text/plain", "no");
      return sendFile(res, path.join(folder, items[i].file));
    }
    if (p.startsWith("/mugs/")) return sendFile(res, path.join(ROOT, "public", "mugs", path.basename(p)));
    if (p === "/label" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const it = items[b.idx];
      if (!it) return send(res, 400, "application/json", JSON.stringify({ error: "bad idx" }));
      if (b.chosenNum == null) labels.delete(it.file);
      else {
        const e = catalog.find((c) => c.num === b.chosenNum);
        labels.set(it.file, { chosenNum: b.chosenNum, chosenName: e ? e.nameEn : null, ts: new Date().toISOString() });
      }
      await persist();
      return send(res, 200, "application/json", JSON.stringify({ ok: true, labeled: labels.size }));
    }
    send(res, 404, "text/plain", "not found");
  } catch (e) { send(res, 500, "text/plain", String(e)); }
});

server.listen(PORT, () => console.log(`\nOpen http://localhost:${PORT}  (labels → ${path.relative(ROOT, OUT)})`));

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Label mugs</title>
<style>
:root{--bg:#faf8fc;--card:#fff;--bd:#e7e2ee;--ac:#6b4e8c;--mut:#6a6472}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:#1b1b1b}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--bd)}
h1{font-size:18px;margin:0;font-weight:500}#prog{color:var(--mut);font-size:14px}
main{max-width:820px;margin:0 auto;padding:20px}
#photo{max-width:100%;max-height:46vh;display:block;margin:0 auto;border-radius:10px}
#hint{text-align:center;color:var(--mut);margin:12px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{position:relative;border:1px solid var(--bd);border-radius:12px;background:var(--card);padding:12px;cursor:pointer;text-align:center;transition:border-color .15s,background .15s}
.card:hover{border-color:var(--ac);background:#f3eef8}
.card img{width:100%;aspect-ratio:1;object-fit:contain}
.nm{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt{font-size:12px;color:var(--mut)}
.key{position:absolute;top:8px;left:8px;background:var(--ac);color:#fff;border-radius:6px;font-size:12px;padding:1px 7px}
#actions{display:flex;gap:10px;justify-content:center;margin:16px 0}
button{padding:10px 16px;border-radius:999px;border:1px solid var(--bd);background:#fff;cursor:pointer;font-size:14px}
#noneWrap{margin-top:12px}#search{width:100%;padding:11px 14px;border:1px solid var(--bd);border-radius:8px;font-size:15px}
#allList{max-height:40vh;overflow:auto;margin-top:8px;border:1px solid var(--bd);border-radius:8px;background:#fff}
.row{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--bd)}
.row:hover{background:#f3eef8}.row img{width:38px;height:38px;object-fit:contain}
</style></head><body>
<header><h1>Label mugs</h1><div id="prog"></div></header>
<main><div id="stage">
  <img id="photo" alt="">
  <div id="hint">Which mug is this? Press 1-4, or N for none/search.</div>
  <div class="grid" id="grid"></div>
  <div id="noneWrap" hidden><input id="search" placeholder="Search all mugs..."><div id="allList"></div></div>
  <div id="actions"><button id="noneBtn">None / search</button><button id="backBtn">Back</button><button id="skipBtn">Skip</button></div>
</div></main>
<script>
var items=[],catalog=[],idx=0,labels={};
function $(id){return document.getElementById(id);}
function render(){
  var it=items[idx];
  if(!it){$('stage').innerHTML='<h2>Done. '+Object.keys(labels).length+' labeled, saved to labels.jsonl</h2>';return;}
  $('prog').textContent=(idx+1)+' / '+items.length+'  \\u00b7  '+Object.keys(labels).length+' labeled';
  $('photo').src='/photo/'+idx;
  var g=$('grid');g.innerHTML='';
  it.candidates.forEach(function(num,i){
    var e=catalog.filter(function(c){return c.num===num;})[0];if(!e)return;
    var card=document.createElement('div');card.className='card';
    card.innerHTML='<img src="'+e.image+'"><div class="nm">'+(e.nameSv||e.nameEn)+'</div><div class="mt">'+(e.year||'')+'</div><div class="key">'+(i+1)+'</div>';
    card.onclick=function(){choose(num);};
    g.appendChild(card);
  });
  renderAll();
}
function renderAll(){
  var q=($('search').value||'').toLowerCase();
  var list=$('allList');list.innerHTML='';
  catalog.filter(function(e){return !q||(e.nameEn+' '+(e.nameSv||'')+' '+e.year).toLowerCase().indexOf(q)>=0;}).slice(0,80).forEach(function(e){
    var row=document.createElement('div');row.className='row';
    row.innerHTML='<img src="'+e.image+'"><span>'+(e.nameSv||e.nameEn)+'</span>';
    row.onclick=function(){choose(e.num);};
    list.appendChild(row);
  });
}
function choose(num){
  fetch('/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idx:idx,chosenNum:num})});
  labels[items[idx].file]=num;next();
}
function skip(){next();}
function next(){idx++;$('noneWrap').hidden=true;$('search').value='';render();}
function back(){if(idx>0){idx--;render();}}
document.addEventListener('keydown',function(e){
  if(e.target===$('search'))return;
  if(e.key>='1'&&e.key<='4'){var it=items[idx];if(it&&it.candidates[+e.key-1]!=null)choose(it.candidates[+e.key-1]);}
  else if(e.key==='n'||e.key==='0'){$('noneWrap').hidden=false;$('search').focus();}
  else if(e.key==='ArrowRight'){skip();}
  else if(e.key==='ArrowLeft'){back();}
});
$('noneBtn').onclick=function(){$('noneWrap').hidden=false;$('search').focus();};
$('search').oninput=renderAll;
$('skipBtn').onclick=skip;
$('backBtn').onclick=back;
fetch('/data').then(function(r){return r.json();}).then(function(d){items=d.items;return fetch('/catalog');}).then(function(r){return r.json();}).then(function(c){catalog=c;render();});
</script></body></html>`;
