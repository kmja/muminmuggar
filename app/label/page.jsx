"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MASTER_CATALOG from "../../lib/master-catalog.json";
import { matchMug, warmUp, isReady, getProgress } from "../../lib/image-match";
import { getDeviceId } from "../../lib/device";
import { createSearch } from "../../lib/search";

const searchCatalog = createSearch(MASTER_CATALOG, { nameEn: (e) => e.nameEn, nameSv: (e) => e.nameSv, years: (e) => e.year });

/* On-site labeling + fine-tuning. Upload real mug photos, click through the
 * model's top-4, and record the correct catalogue mug. Everything is stored in
 * the database (owner-scoped), and the probe can be fine-tuned here. */

const svName = (num, fallback) => MASTER_CATALOG.find((e) => e.num === num)?.nameSv || fallback;
const fileToDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ""));
  r.onerror = () => rej(new Error("read failed"));
  r.readAsDataURL(file);
});

export default function LabelPage() {
  const dev = useMemo(() => getDeviceId(), []);
  const jfetch = useCallback((url, opts = {}) => fetch(url, { ...opts, headers: { "Content-Type": "application/json", "x-device-id": dev, ...(opts.headers || {}) } }), [dev]);
  const imgSrc = (id) => `/api/label-images/${id}?d=${encodeURIComponent(dev)}`;

  const [images, setImages] = useState(null);
  const [labels, setLabels] = useState({});
  const [idx, setIdx] = useState(0);
  const [match, setMatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [pct, setPct] = useState(0);
  const [model, setModel] = useState(null);
  const [uploading, setUploading] = useState("");
  const [ftMsg, setFtMsg] = useState("");
  const fileRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [a, b, m] = await Promise.all([
        jfetch("/api/label-images").then((r) => r.json()),
        jfetch("/api/labels").then((r) => r.json()),
        jfetch("/api/model").then((r) => (r.ok ? r.json() : null)),
      ]);
      const list = a.images || [];
      const map = {};
      for (const r of b.rows || []) if (r.imageId != null) map[r.imageId] = r;
      setImages(list);
      setLabels(map);
      setModel(m);
      const first = list.findIndex((im) => !map[im.id]);
      setIdx(first < 0 ? list.length : first);
    } catch (e) { setError(String(e)); setImages([]); }
  }, [jfetch]);

  useEffect(() => { warmUp(); loadAll(); }, [loadAll]);
  useEffect(() => { const id = setInterval(() => setPct(getProgress()), 500); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!images || idx >= images.length) return;
    let cancelled = false;
    (async () => {
      setBusy(true); setError(""); setMatch(null); setShowAll(false); setSearch("");
      try {
        const r = await matchMug(imgSrc(images[idx].id), { topK: 4 });
        if (!cancelled) setMatch(r);
      } catch (e) { if (!cancelled) setError("Match failed: " + String(e)); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, idx]);

  const choose = (num, nameEn) => {
    const im = images[idx];
    const candidates = (match?.candidates || []).map((c) => c.num);
    setLabels((m) => ({ ...m, [im.id]: { imageId: im.id, chosenNum: num } }));
    jfetch("/api/labels", { method: "POST", body: JSON.stringify({ imageId: im.id, name: im.name, chosenNum: num, chosenName: nameEn, candidates, embedding: match?.embedding }) })
      .then((r) => r.json()).then((r) => { if (r.error) setError(r.error); }).catch(() => {});
    setIdx((i) => i + 1);
  };
  const skip = () => setIdx((i) => i + 1);
  const back = () => setIdx((i) => Math.max(0, i - 1));

  const upload = async (files) => {
    if (!files?.length) return;
    setError("");
    let n = 0;
    for (const f of files) {
      setUploading(`${++n}/${files.length}`);
      try {
        const url = await fileToDataUrl(f);
        const [meta, b64] = url.split(",");
        const mime = meta.slice(5).split(";")[0] || "image/jpeg";
        await jfetch("/api/label-images", { method: "POST", body: JSON.stringify({ name: f.name, mime, data: b64 }) });
      } catch (e) { setError(`Upload failed for ${f.name}: ${String(e)}`); }
    }
    setUploading("");
    await loadAll();
  };

  const removeCurrent = async () => {
    const im = images[idx];
    if (!im || !window.confirm("Remove this photo? Its label (if any) is deleted too.")) return;
    await jfetch(`/api/label-images/${im.id}`, { method: "DELETE" });
    setImages((list) => list.filter((x) => x.id !== im.id));
    setLabels((m) => { const n = { ...m }; delete n[im.id]; return n; });
  };
  const clearAll = async () => {
    if (!window.confirm("Delete ALL uploaded photos and their labels? This cannot be undone.")) return;
    await jfetch("/api/label-images", { method: "DELETE" });
    setLabels({}); setImages([]); setIdx(0); setMatch(null);
    await loadAll();
  };
  const finetune = async () => {
    setFtMsg("Fine-tuning…");
    try {
      const r = await jfetch("/api/finetune", { method: "POST", body: JSON.stringify({}) }).then((x) => x.json());
      if (r.error) setFtMsg(r.error + (Array.isArray(r.lengths) && r.lengths.length ? ` [embedding lengths: ${r.lengths.join(", ")}]` : ""));
      else { setFtMsg(`Fine-tuned on ${r.n} photos${r.skipped ? ` (${r.skipped} skipped)` : ""} — cross-validated top-1 ${r.cv.top1}/${r.n}, top-5 ${r.cv.top5}/${r.n}. Applied.`); await loadAll(); }
    } catch (e) { setFtMsg(String(e)); }
  };
  const resetModel = async () => {
    setFtMsg("");
    await jfetch("/api/model", { method: "DELETE" });
    await loadAll();
  };

  useEffect(() => {
    const h = (e) => {
      if (e.target && e.target.tagName === "INPUT") return;
      const cs = match?.candidates || [];
      if (e.key >= "1" && e.key <= "4" && cs[+e.key - 1]) choose(cs[+e.key - 1].num, cs[+e.key - 1].nameEn);
      else if (e.key === "n" || e.key === "0") setShowAll(true);
      else if (e.key === "ArrowRight") skip();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const allList = useMemo(() => (search.trim() ? searchCatalog(search) : MASTER_CATALOG).slice(0, 80), [search]);

  const done = images && idx >= images.length;
  const labeled = Object.keys(labels).length;
  const acc = model?.accuracy;

  return (
    <div className="wrap" style={{ maxWidth: 760, paddingBottom: 40 }}>
      <div className="top">
        <div className="title"><h1>Label mugs</h1><span className="ver">{images ? `${Math.min(idx + 1, images.length)} / ${images.length} · ${labeled} labeled` : "loading…"}</span></div>
        <div className="actions"><a className="ghost icon" href="/" title="Back to app" style={{ textDecoration: "none" }}>×</a></div>
      </div>

      <div className="card pad" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 500 }}>{model?.custom ? "Custom model (fine-tuned on your photos)" : "Default model"}</div>
            <div className="mini" style={{ marginTop: 4 }}>{acc && acc.n ? `Accuracy on your ${acc.n} labels: top-1 ${acc.top1}/${acc.n}, top-5 ${acc.top5}/${acc.n}` : "Label some photos to measure accuracy."}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={finetune} disabled={!labeled}>Fine-tune</button>
            {model?.custom ? <button onClick={resetModel}>Reset</button> : null}
            <a className="btn" href={`/api/labels/export?d=${encodeURIComponent(dev)}`} download style={{ textDecoration: "none" }}>Export</a>
          </div>
        </div>
        {ftMsg ? <div className="note" style={{ marginTop: 10 }}>{ftMsg}</div> : null}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => fileRef.current?.click()} disabled={!!uploading}>{uploading ? `Uploading ${uploading}…` : "Upload photos"}</button>
        {images && images.length ? <button onClick={clearAll}>Clear all</button> : null}
        <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(e) => { upload([...e.target.files]); e.target.value = ""; }} />
      </div>

      {error ? <div className="note warn" style={{ marginBottom: 12 }}>{error}</div> : null}
      {images && images.length === 0 ? <div className="note">No photos yet — upload some above.</div> : null}

      {done ? (
        <div className="card pad" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20 }}>All done</div>
          <div className="sub" style={{ marginTop: 6 }}>{labeled} labeled. Fine-tune above to apply them.</div>
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}><button onClick={() => setIdx(0)}>Review from start</button></div>
        </div>
      ) : null}

      {!done && images && images.length ? (
        <>
          <img src={imgSrc(images[idx].id)} alt="" style={{ width: "100%", maxHeight: "46vh", objectFit: "contain", borderRadius: 12, background: "var(--bg2)" }} />

          {busy ? <div className="drop" style={{ marginTop: 12 }}><span className="spin" /> <div style={{ marginTop: 8 }}>Matching…</div>{!isReady() ? <div className="help" style={{ marginTop: 8 }}>{pct > 0 ? `Loading image model… ${Math.round(pct)}%` : "Loading image model (first time can take a moment)…"}</div> : null}</div> : null}

          {match ? (
            <>
              <div className="help" style={{ margin: "12px 0 8px" }}>Which mug is this? Press 1–4, or N for none/search.</div>
              <div className="matchgrid">
                {match.candidates.map((c, i) => (
                  <div className="matchcard" key={c.num} role="button" tabIndex={0}
                    onClick={() => choose(c.num, c.nameEn)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(c.num, c.nameEn); } }}>
                    <img src={c.image} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    <div className="mname" title={svName(c.num, c.nameEn)}>{svName(c.num, c.nameEn)}</div>
                    <div className="mmeta">{c.year || ""}</div>
                    <div className="badge">{i + 1}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
            <button onClick={() => setShowAll((v) => !v)}>None / search</button>
            <button onClick={back} disabled={idx === 0}>Back</button>
            <button onClick={skip}>Skip</button>
            <button onClick={removeCurrent} className="danger">Remove photo</button>
          </div>

          {showAll ? (
            <div style={{ marginTop: 12 }}>
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all mugs…" />
              <div className="list" style={{ marginTop: 8, maxHeight: "42vh", overflow: "auto" }}>
                {allList.map((e) => (
                  <button key={e.num} className="pickitem" onClick={() => choose(e.num, e.nameEn)}>
                    <span className="pickthumb">{e.image ? <img src={e.image} alt="" /> : null}</span>
                    <span className="pickname">{e.nameSv || e.nameEn}<span className="pickmeta">{[e.year, e.capacity].filter(Boolean).join(" · ")}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
