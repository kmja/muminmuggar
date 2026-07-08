"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ----------------------------- constants ----------------------------- */
const STATUSES = [
  { value: "owned", label: "Owned" },
  { value: "wishlist", label: "Wishlist" },
  { value: "sold", label: "Sold" },
];
const CONDITIONS = ["New", "Like New", "Very Good", "Good", "Fair", "Poor"];

/* ----------------------------- helpers -------------------------------- */
const normalizeText = (s) => (s || "").toString().trim().toLowerCase();
const toISODate = (d) => (d ? String(d).slice(0, 10) : "");
const tokenizeTags = (s) => (s || "").split(/[,#\n]+/).map((t) => t.trim()).filter(Boolean);
function formatMoney(amount, currency = "SEK") {
  if (amount === "" || amount == null) return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n)} ${currency}`; }
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("Failed to read image"));
    r.onload = () => res(String(r.result || ""));
    r.readAsDataURL(file);
  });
}
function downscaleImage(dataUrl, maxDim = 1400, quality = 0.84) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      try { res(c.toDataURL("image/jpeg", quality)); } catch { res(dataUrl); }
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  let j = {};
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function findDuplicates(cand, mugs) {
  const n = normalizeText(cand.name);
  if (!n) return [];
  return mugs.filter((m) => {
    if (cand.id && m.id === cand.id) return false;
    if (normalizeText(m.name) !== n) return false;
    const sameYear = cand.year && m.year && String(cand.year) === String(m.year);
    const sameSeries = normalizeText(cand.series) && normalizeText(cand.series) === normalizeText(m.series);
    return sameYear || sameSeries || (!cand.year && !cand.series);
  });
}
function blankMug() {
  return { name: "", series: "Arabia Moomin", edition: "", year: "", status: "owned", condition: "Good",
    conditionNotes: "", location: "", acquiredDate: "", price: "", currency: "SEK", favorite: false,
    photoUrl: "", estValueLow: null, estValueHigh: null, estValueCurrency: "SEK", notes: "", tags: [], aiConfidence: null };
}

/* --------------------------- UI primitives ---------------------------- */
function Badge({ children, kind }) { return <span className={"badge " + (kind || "")}>{children}</span>; }
function Modal({ open, title, subtitle, children, onClose, footer, wide }) {
  if (!open) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={"modal" + (wide ? " wide" : "")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="head">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div><h2>{title}</h2>{subtitle ? <div className="help" style={{ marginTop: 6 }}>{subtitle}</div> : null}</div>
            <button className="ghost icon" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="body">{children}</div>
        {footer ? <div className="foot">{footer}</div> : null}
      </div>
    </div>
  );
}
function Confidence({ v }) {
  if (v == null) return null;
  const pct = Math.round(Number(v) * 100);
  const col = pct >= 75 ? "var(--accent2)" : pct >= 45 ? "var(--gold)" : "var(--danger)";
  return <span className="conf" title="Gemini confidence"><span style={{ width: 8, height: 8, borderRadius: 99, background: col, display: "inline-block" }} /><b>{pct}%</b> sure</span>;
}
function MugMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 17h20v13a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z" />
      <path d="M33 20h3.5a4.5 4.5 0 0 1 0 9H33" />
      <path d="M18 8.5c0 2-1.8 2-1.8 3.8M24 8.5c0 2-1.8 2-1.8 3.8M30 8.5c0 2-1.8 2-1.8 3.8" opacity="0.55" />
    </svg>
  );
}

/* ------------------------------ MugForm ------------------------------- */
function validateMug(m) {
  const e = {};
  if (!m.name || !m.name.trim()) e.name = "A name/character is required.";
  if (m.year !== "" && m.year != null) { const y = Number(m.year); if (!Number.isInteger(y) || y < 1900 || y > 2100) e.year = "Year must be 1900–2100."; }
  if (m.price !== "" && m.price != null) { const p = Number(m.price); if (!Number.isFinite(p) || p < 0) e.price = "Price must be positive."; }
  return e;
}
function MugForm({ open, onClose, initial, onSave, mugs, mode, saving }) {
  const [d, setD] = useState(initial);
  const [tagInput, setTagInput] = useState((initial?.tags || []).join(", "));
  const [errors, setErrors] = useState({});
  const uploadRef = useRef(null);
  useEffect(() => { setD(initial); setTagInput((initial?.tags || []).join(", ")); setErrors({}); }, [initial, open]);
  const dups = useMemo(() => (mode === "create" && d ? findDuplicates(d, mugs || []) : []), [d?.name, d?.year, d?.series, mode, mugs]);
  if (!d) return null;
  const up = (patch) => setD((x) => ({ ...x, ...patch }));

  const footer = (
    <>
      <button onClick={onClose}>Cancel</button>
      <button className="primary" disabled={saving} onClick={() => {
        const next = { ...d, year: d.year === "" ? "" : Number(d.year), price: d.price === "" ? "" : Number(d.price), acquiredDate: toISODate(d.acquiredDate), tags: tokenizeTags(tagInput) };
        const e = validateMug(next); setErrors(e); if (Object.keys(e).length) return;
        onSave(next);
      }}>{saving ? <span className="spin" /> : "Save mug"}</button>
    </>
  );

  return (
    <Modal open={open} title={mode === "edit" ? "Edit mug" : "Add mug"} subtitle="Fill in as little or as much as you like." onClose={onClose} footer={footer}>
      <div className="grid" style={{ gap: 12 }}>
        {d.photoUrl ? <div className="card" style={{ overflow: "hidden" }}><img src={d.photoUrl} alt="Mug" style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }} /></div> : null}
        {d.aiConfidence != null ? <div className="row" style={{ justifyContent: "space-between" }}><Confidence v={d.aiConfidence} /><span className="help">Auto-identified — please double-check.</span></div> : null}
        {dups.length ? <div className="note warn">⚠︎ You may already own this: {dups.map((x) => x.name + (x.year ? ` (${x.year})` : "")).join(", ")}. Save anyway if it's a second one.</div> : null}

        <div className="row">
          <div className="field" style={{ flex: 2, minWidth: 200 }}><label>Name / character *</label><input value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Moominmamma" />{errors.name ? <div className="err">{errors.name}</div> : null}</div>
          <div className="field" style={{ minWidth: 150 }}><label>Status *</label><select value={d.status} onChange={(e) => up({ status: e.target.value })}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        </div>
        <div className="row">
          <div className="field"><label>Series</label><input value={d.series || ""} onChange={(e) => up({ series: e.target.value })} placeholder="e.g. Arabia Moomin" /></div>
          <div className="field"><label>Edition</label><input value={d.edition || ""} onChange={(e) => up({ edition: e.target.value })} placeholder="Standard / Seasonal / Limited" /></div>
        </div>
        <div className="row">
          <div className="field"><label>Year</label><input inputMode="numeric" value={d.year ?? ""} onChange={(e) => up({ year: e.target.value })} placeholder="e.g. 2019" />{errors.year ? <div className="err">{errors.year}</div> : null}</div>
          <div className="field"><label>Condition</label><select value={d.condition || "Good"} onChange={(e) => up({ condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div className="field"><label>Condition notes</label><input value={d.conditionNotes || ""} onChange={(e) => up({ conditionNotes: e.target.value })} placeholder="Chips, crazing, gilding wear…" /></div>
        <div className="row">
          <div className="field"><label>Location</label><input value={d.location || ""} onChange={(e) => up({ location: e.target.value })} placeholder="e.g. Living-room shelf" /></div>
          <div className="field"><label>Acquired date</label><input type="date" value={toISODate(d.acquiredDate)} onChange={(e) => up({ acquiredDate: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Paid</label><input inputMode="decimal" value={d.price ?? ""} onChange={(e) => up({ price: e.target.value })} placeholder="e.g. 249" />{errors.price ? <div className="err">{errors.price}</div> : null}</div>
          <div className="field"><label>Currency</label><input value={d.currency || ""} onChange={(e) => up({ currency: e.target.value })} placeholder="SEK" /></div>
        </div>
        <div className="row">
          <div className="field"><label>Est. value (low)</label><input inputMode="decimal" value={d.estValueLow ?? ""} onChange={(e) => up({ estValueLow: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" /></div>
          <div className="field"><label>Est. value (high)</label><input inputMode="decimal" value={d.estValueHigh ?? ""} onChange={(e) => up({ estValueHigh: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" /></div>
          <div className="field" style={{ maxWidth: 120 }}><label>Val. currency</label><input value={d.estValueCurrency || ""} onChange={(e) => up({ estValueCurrency: e.target.value })} placeholder="SEK" /></div>
        </div>
        <div className="field"><label>Tags</label><input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="limited, blue, snufkin" /></div>
        <div className="switch"><span className="mini">Mark as favorite ★</span><input type="checkbox" checked={!!d.favorite} onChange={(e) => up({ favorite: e.target.checked })} style={{ width: "auto" }} /></div>
        <div className="field">
          <label>Photo</label>
          <div className="row">
            <button type="button" onClick={() => uploadRef.current?.click()}>Upload / replace</button>
            <button type="button" className={d.photoUrl ? "danger" : ""} disabled={!d.photoUrl} onClick={() => up({ photoUrl: "" })}>Clear</button>
            <input className="sr-only" ref={uploadRef} type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const raw = await fileToDataUrl(f); up({ photoUrl: await downscaleImage(raw) }); e.target.value = ""; }} />
          </div>
        </div>
        <div className="field"><label>Notes</label><textarea value={d.notes || ""} onChange={(e) => up({ notes: e.target.value })} placeholder="Anything worth remembering…" /></div>
      </div>
    </Modal>
  );
}

/* ------------------------------ ScanModal ----------------------------- */
function ScanModal({ open, onClose, onAddOne, onAddMany, mugs }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const camRef = useRef(null), fileRef = useRef(null);
  useEffect(() => { if (open) { setBusy(false); setError(""); setItems([]); setPhotoUrl(""); } }, [open]);

  const run = async (file) => {
    setError("");
    if (!file) return;
    setBusy(true); setItems([]);
    try {
      const raw = await fileToDataUrl(file);
      const small = await downscaleImage(raw, 1400, 0.85);
      setPhotoUrl(small);
      // Always detect every mug in the photo — one or many.
      const { drafts } = await api("/api/shelf-scan", { method: "POST", body: JSON.stringify({ imageDataUrl: small }) });
      if (!drafts.length) { setError("No mugs detected. Try a clearer, closer photo."); return; }
      if (drafts.length === 1) {
        // A single mug: attach the photo and open the full review form.
        onAddOne({ ...drafts[0], photoUrl: small });
        onClose();
        return;
      }
      setItems(drafts.map((d) => ({ draft: { ...d, photoUrl: "" }, checked: d.isMoominMug !== false, position: d.position || "" })));
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  const patchItem = (i, patch) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, draft: { ...it.draft, ...patch } } : it)));
  const chosen = items.filter((it) => it.checked).length;
  const footer = items.length ? (
    <>
      <button onClick={() => { setItems([]); setPhotoUrl(""); }}>Rescan</button>
      <button className="primary" disabled={!chosen} onClick={() => { onAddMany(items.filter((it) => it.checked).map((it) => it.draft)); onClose(); }}>Add {chosen} mug{chosen === 1 ? "" : "s"}</button>
    </>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} wide title="Scan mugs" subtitle="Photograph one mug or a whole shelf — we'll find every mug in the photo." footer={footer}>
      {!items.length && !busy ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="row">
            <button className="primary" style={{ flex: 1, justifyContent: "center", padding: "14px" }} onClick={() => camRef.current?.click()}>📷 Take photo</button>
            <button style={{ flex: 1, justifyContent: "center", padding: "14px" }} onClick={() => fileRef.current?.click()}>🖼 Choose image</button>
          </div>
          <input className="sr-only" ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; run(f); e.target.value = ""; }} />
          <input className="sr-only" ref={fileRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; run(f); e.target.value = ""; }} />
          <div className="help">Tip: good light and a straight-on angle help. Point at a whole shelf to add many at once.</div>
        </div>
      ) : null}

      {busy ? <div className="drop"><span className="spin" /> <div style={{ marginTop: 8 }}>Looking at your photo…</div></div> : null}
      {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}

      {items.length && !busy ? (
        <div className="grid" style={{ gap: 10, marginTop: error ? 10 : 0 }}>
          {photoUrl ? <div className="card" style={{ overflow: "hidden" }}><img src={photoUrl} alt="scan" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} /></div> : null}
          {items.map((it, i) => {
            const dups = findDuplicates(it.draft, mugs || []);
            return (
              <div className="scanrow" key={i}>
                <input type="checkbox" checked={it.checked} onChange={(e) => setItems((list) => list.map((x, idx) => (idx === i ? { ...x, checked: e.target.checked } : x)))} style={{ width: "auto", marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <input value={it.draft.name} onChange={(e) => patchItem(i, { name: e.target.value })} style={{ fontWeight: 800, maxWidth: 220 }} />
                    <Confidence v={it.draft.aiConfidence} />
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input value={it.draft.series || ""} onChange={(e) => patchItem(i, { series: e.target.value })} placeholder="Series" style={{ flex: 2, minWidth: 120 }} />
                    <input value={it.draft.year ?? ""} onChange={(e) => patchItem(i, { year: e.target.value })} placeholder="Year" style={{ maxWidth: 90 }} />
                    <input value={it.draft.edition || ""} onChange={(e) => patchItem(i, { edition: e.target.value })} placeholder="Edition" style={{ flex: 1, minWidth: 100 }} />
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {it.position ? <Badge>📍 {it.position}</Badge> : null}
                    {it.draft.condition ? <Badge>✓ {it.draft.condition}</Badge> : null}
                    {(it.draft.estValueLow != null || it.draft.estValueHigh != null) ? <Badge>💰 {formatMoney(it.draft.estValueLow ?? it.draft.estValueHigh, it.draft.estValueCurrency)}</Badge> : null}
                    {dups.length ? <Badge kind="fav">⚠︎ possible duplicate</Badge> : null}
                  </div>
                  {it.draft.conditionNotes ? <div className="mini" style={{ marginTop: 6 }}>{it.draft.conditionNotes}</div> : null}
                </div>
              </div>
            );
          })}
          <div className="help">Found {items.length} mugs. Untick any you don't want, edit inline, then add.</div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------ GapFinder ----------------------------- */
function GapFinder({ open, onClose, mugs, onAddWishlist }) {
  const [series, setSeries] = useState("Arabia Moomin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null);
  useEffect(() => { if (open) { setBusy(false); setError(""); setRows(null); } }, [open]);
  const ownedNames = useMemo(() => new Set(mugs.filter((m) => m.status !== "wishlist").map((m) => normalizeText(m.name))), [mugs]);

  const run = async () => {
    setError(""); setBusy(true); setRows(null);
    try {
      const { catalog } = await api("/api/gaps", { method: "POST", body: JSON.stringify({ series: series.trim() }) });
      if (!catalog.length) setError("No results — try a more specific series name.");
      setRows(catalog.map((c) => ({ ...c, owned: ownedNames.has(normalizeText(c.character)) })));
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  const missing = (rows || []).filter((r) => !r.owned);
  const footer = rows ? (
    <>
      <button onClick={() => setRows(null)}>New search</button>
      <button className="primary" disabled={!missing.length} onClick={() => {
        const drafts = missing.map((r) => ({ ...blankMug(), name: r.character, series, edition: r.edition || "", year: r.year != null ? r.year : "", status: "wishlist", notes: r.notes || "" }));
        onAddWishlist(drafts); onClose();
      }}>Wishlist {missing.length} missing</button>
    </>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} wide title="Find gaps in a series" subtitle="See which mugs from a series you're missing, and wishlist them in one tap." footer={footer}>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>Series / line</label><input value={series} onChange={(e) => setSeries(e.target.value)} placeholder="e.g. Arabia Moomin, Moomin seasonal winter" /></div>
        <button className="primary" onClick={run} disabled={busy} style={{ alignSelf: "flex-end" }}>{busy ? <span className="spin" /> : "Search"}</button>
      </div>
      {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}
      {rows ? (
        <div className="grid" style={{ gap: 8, marginTop: 12 }}>
          <div className="help">{rows.filter((r) => r.owned).length} owned · {missing.length} missing (of {rows.length}). AI catalog may be incomplete — treat as a guide.</div>
          {rows.map((r, i) => (
            <div className="listrow" key={i} style={{ opacity: r.owned ? 0.6 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{r.owned ? "✓ " : ""}{r.character}{r.year ? <span className="muted"> · {r.year}</span> : null}</div>
                {r.edition || r.notes ? <div className="mini">{[r.edition, r.notes].filter(Boolean).join(" — ")}</div> : null}
              </div>
              <Badge kind={r.owned ? "owned" : "wishlist"}>{r.owned ? "Owned" : "Missing"}</Badge>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------ DealsModal ---------------------------- */
function DealsModal({ open, onClose, mug }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listings, setListings] = useState([]);
  const [web, setWeb] = useState(null);
  useEffect(() => {
    if (open && mug) { setError(""); setWeb(null); setListings(mug.listings || []); run(); }
  }, [open, mug?.id]);

  const run = async () => {
    setError(""); setBusy(true);
    try {
      const j = await api("/api/deals", { method: "POST", body: JSON.stringify({ mugId: mug.id }) });
      setListings(j.listings?.length ? j.listings : (mug.listings || []));
      setWeb(j.web || null);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={mug ? `Find “${mug.name}”` : "Find deals"} subtitle="Searches marketplaces now; the daily checker notifies you of new listings automatically." footer={<button className="primary" onClick={run} disabled={busy}>{busy ? <span className="spin" /> : "Search again"}</button>}>
      {busy && !listings.length ? <div className="drop"><span className="spin" /><div style={{ marginTop: 8 }}>Searching marketplaces…</div></div> : null}
      {error ? <div className="err">{error}</div> : null}

      {listings.length ? (
        <div className="grid" style={{ gap: 8 }}>
          <div className="help">{listings.length} live listing{listings.length === 1 ? "" : "s"} (structured sources)</div>
          {listings.map((l, i) => (
            <a className="srcitem" key={i} href={l.url} target="_blank" rel="noopener noreferrer">
              {l.imageUrl ? <img src={l.imageUrl} alt="" /> : null}
              <div style={{ minWidth: 0 }}>
                <div className="link" style={{ fontWeight: 700 }}>{l.title}</div>
                <div className="mini">{[l.source, l.condition, l.price != null ? formatMoney(l.price, l.currency || "") : null].filter(Boolean).join(" · ")}</div>
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {web ? (
        <div className="grid" style={{ gap: 10, marginTop: 12 }}>
          {web.text ? <div className="note" style={{ whiteSpace: "pre-wrap" }}>{web.text}</div> : null}
          {web.sources?.length ? (
            <div className="grid" style={{ gap: 8 }}>
              <div className="help">Web sources</div>
              {web.sources.map((s, i) => <a className="srcitem" key={i} href={s.uri} target="_blank" rel="noopener noreferrer"><span className="link">{s.title}</span></a>)}
            </div>
          ) : null}
        </div>
      ) : null}

      {!busy && !listings.length && !web?.sources?.length ? <div className="help">No listings found right now. The daily checker keeps looking and will notify you.</div> : null}
    </Modal>
  );
}

/* ------------------------------- MugCard ------------------------------ */
function MugCard({ m, onEdit, onDelete, onFav, onDeals }) {
  const val = (m.estValueLow != null || m.estValueHigh != null)
    ? `${formatMoney(m.estValueLow ?? m.estValueHigh, m.estValueCurrency || "SEK")}${m.estValueLow != null && m.estValueHigh != null ? "–" + formatMoney(m.estValueHigh, m.estValueCurrency || "SEK") : ""}`
    : "";
  const dealCount = m.listings?.length || 0;
  return (
    <div className="card mug">
      <div className="mugphoto">
        {m.photoUrl ? <img src={m.photoUrl} alt={m.name} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span className="ph"><MugMark size={46} /></span>}
        <div className="abschip">
          <Badge kind={m.status}>{m.status === "owned" ? "Owned" : m.status === "wishlist" ? "Wishlist" : "Sold"}</Badge>
          {m.favorite ? <Badge kind="fav">★</Badge> : null}
        </div>
      </div>
      <div className="mugbody">
        <div className="mugname" title={m.name}>{m.name || "Untitled"}</div>
        <div className="sub">{[m.series || "—", m.year, m.edition].filter(Boolean).join(" · ")}</div>
        <div className="badges">
          {m.condition ? <Badge>✓ {m.condition}</Badge> : null}
          {m.price !== "" && m.price != null ? <Badge>💰 {formatMoney(m.price, m.currency || "SEK")}</Badge> : null}
          {val ? <Badge title="Estimated market value">≈ {val}</Badge> : null}
          {m.location ? <Badge>📍 {m.location}</Badge> : null}
          {m.status === "wishlist" && dealCount ? <Badge kind="deal">🔔 {dealCount} found</Badge> : null}
        </div>
        {m.tags?.length ? <div className="badges">{m.tags.slice(0, 6).map((t) => <span key={t} className="chip">#{t}</span>)}</div> : null}
        {m.conditionNotes ? <div className="mini lineclamp">{m.conditionNotes}</div> : null}
        {m.notes ? <div className="mini lineclamp">{m.notes}</div> : null}
        <div className="mugfoot">
          {m.status === "wishlist" ? <button onClick={() => onDeals(m)}>🔎 Deals</button> : <button onClick={() => onFav(m)}>{m.favorite ? "★" : "☆"} Fav</button>}
          <button onClick={() => onEdit(m)}>Edit</button>
          <button className="danger" onClick={() => onDelete(m)}>Delete</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- App --------------------------------- */
export default function App() {
  const [mugs, setMugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("collection");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sortBy, setSortBy] = useState("updated_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [formInitial, setFormInitial] = useState(null);
  const [formMode, setFormMode] = useState("create");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [gapOpen, setGapOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [dealsMug, setDealsMug] = useState(null);
  const [notifState, setNotifState] = useState("idle"); // idle | on | error | unsupported
  const [notifMsg, setNotifMsg] = useState("");

  const load = async () => {
    setLoading(true); setLoadError("");
    try { const { mugs } = await api("/api/mugs"); setMugs(mugs); }
    catch (e) { setLoadError(e.message || String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "wishlist") setTab("wishlist");
    // Register the service worker so the app is an installable PWA.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const saveMug = async (next) => {
    setSaving(true);
    try {
      if (next.id && mugs.some((m) => m.id === next.id)) {
        const { mug } = await api(`/api/mugs/${next.id}`, { method: "PATCH", body: JSON.stringify(next) });
        setMugs((prev) => prev.map((m) => (m.id === mug.id ? mug : m)));
      } else {
        const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(next) });
        setMugs((prev) => [mug, ...prev]);
      }
      setFormOpen(false);
    } catch (e) { alert("Save failed: " + (e.message || e)); }
    finally { setSaving(false); }
  };
  const addMany = async (drafts) => {
    try {
      const created = [];
      for (const d of drafts) { const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(d) }); created.push(mug); }
      setMugs((prev) => [...created, ...prev]);
    } catch (e) { alert("Add failed: " + (e.message || e)); }
  };
  const del = async (m) => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    try { await api(`/api/mugs/${m.id}`, { method: "DELETE" }); setMugs((prev) => prev.filter((x) => x.id !== m.id)); }
    catch (e) { alert("Delete failed: " + (e.message || e)); }
  };
  const fav = async (m) => {
    const optimistic = !m.favorite;
    setMugs((prev) => prev.map((x) => (x.id === m.id ? { ...x, favorite: optimistic } : x)));
    try { await api(`/api/mugs/${m.id}`, { method: "PATCH", body: JSON.stringify({ favorite: optimistic }) }); }
    catch { setMugs((prev) => prev.map((x) => (x.id === m.id ? { ...x, favorite: !optimistic } : x))); }
  };

  const openCreate = () => { setFormInitial(blankMug()); setFormMode("create"); setFormOpen(true); };
  const openEdit = (m) => { setFormInitial({ ...m }); setFormMode("edit"); setFormOpen(true); };
  const openReview = (draft) => { setFormInitial({ ...draft }); setFormMode("create"); setFormOpen(true); };

  const enableNotifications = async () => {
    setNotifMsg("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setNotifState("unsupported"); setNotifMsg("This browser doesn't support push notifications."); return; }
      const { publicKey } = await api("/api/push/vapid");
      if (!publicKey) { setNotifState("error"); setNotifMsg("Server has no VAPID key configured yet."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setNotifState("error"); setNotifMsg("Notification permission was denied."); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      setNotifState("on"); setNotifMsg("Notifications enabled on this device. 🎉");
    } catch (e) { setNotifState("error"); setNotifMsg(e.message || String(e)); }
  };

  const viewMugs = useMemo(() => {
    const q = normalizeText(query);
    let out = mugs.filter((m) => {
      if (tab === "wishlist") { if (m.status !== "wishlist") return false; }
      else if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (favoriteOnly && !m.favorite) return false;
      if (!q) return true;
      const hay = [m.name, m.series, m.edition, m.condition, m.conditionNotes, m.location, m.notes, ...(m.tags || []), m.year].filter((x) => x != null).join(" ");
      return normalizeText(hay).includes(q);
    });
    out.sort((a, b) => {
      const au = a.updatedAt ? Date.parse(a.updatedAt) : 0, bu = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (sortBy === "updated_desc") return bu - au;
      if (sortBy === "year_desc") return (Number(b.year) || 0) - (Number(a.year) || 0);
      if (sortBy === "year_asc") return (Number(a.year) || 0) - (Number(b.year) || 0);
      if (sortBy === "value_desc") return (Number(b.estValueHigh ?? b.estValueLow) || 0) - (Number(a.estValueHigh ?? a.estValueLow) || 0);
      return normalizeText(a.name).localeCompare(normalizeText(b.name));
    });
    return out;
  }, [mugs, query, statusFilter, favoriteOnly, sortBy, tab]);

  const stats = useMemo(() => {
    const owned = mugs.filter((m) => m.status === "owned");
    const spent = owned.map((m) => Number(m.price)).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const value = owned.map((m) => Number(m.estValueHigh ?? m.estValueLow)).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const byYear = new Map(); for (const m of mugs) { const y = Number(m.year); if (Number.isFinite(y)) byYear.set(y, (byYear.get(y) || 0) + 1); }
    const byYearData = [...byYear.entries()].sort((a, b) => a[0] - b[0]).slice(-14).map(([year, count]) => ({ year: String(year), count }));
    const charCount = new Map(); for (const m of mugs) { const k = (m.name || "").trim(); if (k) charCount.set(k, (charCount.get(k) || 0) + 1); }
    const topChars = [...charCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    return {
      owned: owned.length, wishlist: mugs.filter((m) => m.status === "wishlist").length,
      sold: mugs.filter((m) => m.status === "sold").length, favorites: mugs.filter((m) => m.favorite).length,
      spent, value, byYearData, topChars, maxYear: Math.max(1, ...byYearData.map((d) => d.count)),
      valueCur: owned.find((m) => m.estValueCurrency)?.estValueCurrency || "SEK",
    };
  }, [mugs]);

  const TABS = [
    { k: "collection", label: "Collection" },
    { k: "wishlist", label: `Wishlist${stats.wishlist ? ` (${stats.wishlist})` : ""}` },
    { k: "stats", label: "Stats" },
  ];

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <div className="logo"><MugMark size={26} /></div>
          <div className="title"><h1>Moomin Mug Collection</h1><div className="sub">Photograph, identify & track — with deal alerts.</div></div>
        </div>
        <div className="actions hide-mobile">
          <button className="primary" onClick={() => setScanOpen(true)}>📷 Scan</button>
          <button onClick={() => setGapOpen(true)}>✨ Gaps</button>
          <button className={"ghost icon"} title="Notifications & about" onClick={() => setAboutOpen(true)}>🔔</button>
        </div>
      </div>

      {loadError ? <div className="note warn" style={{ marginBottom: 12 }}>Couldn't load your collection: {loadError}. Is the database configured? See the README.</div> : null}

      <div className="tabs hide-mobile">{TABS.map((t) => <button key={t.k} className={"tabbtn " + (tab === t.k ? "active" : "")} onClick={() => setTab(t.k)}>{t.label}</button>)}</div>

      {tab !== "stats" ? (
        <>
          <div className="card pad" style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 2, minWidth: 180 }}><label>Search</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, series, tags…" /></div>
              <button type="button" className="only-mobile" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>{filtersOpen ? "▲ Filters" : "▾ Filters"}</button>
            </div>
            <div className={"row filterfields" + (filtersOpen ? " open" : "")} style={{ marginTop: 10 }}>
              {tab === "collection" ? (
                <div className="field" style={{ minWidth: 150 }}><label>Status</label><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
              ) : null}
              <div className="field" style={{ minWidth: 170 }}><label>Sort</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="updated_desc">Recently updated</option>
                  <option value="year_desc">Year (new → old)</option>
                  <option value="year_asc">Year (old → new)</option>
                  <option value="value_desc">Value (high → low)</option>
                  <option value="name">Name (A → Z)</option>
                </select>
              </div>
              <div className="field" style={{ maxWidth: 150 }}><label>Favorites</label><div className="switch"><span className="mini">★ only</span><input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} style={{ width: "auto" }} /></div></div>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <div className="row"><span className="pill">{viewMugs.length} shown</span><span className="pill">{mugs.length} total</span></div>
              <div className="row"><button onClick={() => setGapOpen(true)}>✨ Gaps</button><button onClick={openCreate}>＋ Add</button></div>
            </div>
          </div>

          {loading ? (
            <div className="card pad"><span className="spin" /> Loading…</div>
          ) : mugs.length === 0 ? (
            <div className="card pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>📷</div>
              <div style={{ fontWeight: 900, marginTop: 8 }}>Start your collection</div>
              <div className="sub" style={{ marginTop: 6 }}>Snap a mug and let Gemini fill in the details, or add one by hand.</div>
              <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
                <button className="primary" onClick={() => setScanOpen(true)}>📷 Scan a mug</button>
                <button onClick={openCreate}>＋ Add manually</button>
              </div>
            </div>
          ) : viewMugs.length === 0 ? (
            <div className="card pad"><div className="muted">No mugs match your filters.</div></div>
          ) : (
            <div className="muggrid">{viewMugs.map((m) => <MugCard key={m.id} m={m} onEdit={openEdit} onDelete={del} onFav={fav} onDeals={setDealsMug} />)}</div>
          )}

          {tab === "wishlist" ? <div className="help" style={{ marginTop: 12 }}>Tip: use ✨ Gaps to fill your wishlist from a series, then enable 🔔 notifications to get pinged when one appears for sale.</div> : null}
        </>
      ) : (
        <>
          <div className="kpi">
            <div className="card kpicard"><div className="kpilabel">Owned</div><div className="kpivalue">{stats.owned}</div></div>
            <div className="card kpicard"><div className="kpilabel">Wishlist</div><div className="kpivalue">{stats.wishlist}</div></div>
            <div className="card kpicard"><div className="kpilabel">Favorites</div><div className="kpivalue">{stats.favorites}</div></div>
            <div className="card kpicard"><div className="kpilabel">Sold</div><div className="kpivalue">{stats.sold}</div></div>
          </div>
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div style={{ fontWeight: 800 }}>Total paid (owned)</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 6 }}>{formatMoney(stats.spent, "SEK")}</div></div>
              <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div style={{ fontWeight: 800 }}>Est. collection value</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 6 }}>{formatMoney(stats.value, stats.valueCur)}</div><div className="help" style={{ marginTop: 4 }}>Sum of high estimates on owned mugs.</div></div>
            </div>
            <div className="card pad">
              <div style={{ fontWeight: 800 }}>Mugs by year</div><div className="divider" />
              {stats.byYearData.length ? <div className="list">{stats.byYearData.map((r) => (
                <div key={r.year} className="listrow"><div style={{ fontWeight: 700, width: 52 }}>{r.year}</div><div className="bar"><span style={{ width: `${(r.count / stats.maxYear) * 100}%` }} /></div><span className="pill">{r.count}</span></div>
              ))}</div> : <div className="muted">Add years to your mugs to see this.</div>}
            </div>
            <div className="card pad">
              <div style={{ fontWeight: 800 }}>Top characters</div><div className="divider" />
              {stats.topChars.length ? <div className="list">{stats.topChars.map((t) => <div key={t.name} className="listrow"><div>{t.name}</div><span className="pill">{t.count}</span></div>)}</div> : <div className="muted">Add mugs to see trends.</div>}
            </div>
          </div>
        </>
      )}

      <nav className="bottomnav">
        <button className={"bn " + (tab === "collection" ? "active" : "")} onClick={() => setTab("collection")}><span className="ic">🗄️</span>Collection</button>
        <button className={"bn " + (tab === "wishlist" ? "active" : "")} onClick={() => setTab("wishlist")}><span className="ic">♡</span>Wishlist</button>
        <button className="bn bn-scan" onClick={() => setScanOpen(true)} aria-label="Scan a mug"><span className="ic">📷</span></button>
        <button className={"bn " + (tab === "stats" ? "active" : "")} onClick={() => setTab("stats")}><span className="ic">📊</span>Stats</button>
        <button className="bn" onClick={() => setAboutOpen(true)}><span className="ic">🔔</span>Alerts</button>
      </nav>

      <MugForm open={formOpen} onClose={() => setFormOpen(false)} initial={formInitial} mode={formMode} mugs={mugs} onSave={saveMug} saving={saving} />
      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} mugs={mugs} onAddOne={openReview} onAddMany={addMany} />
      <GapFinder open={gapOpen} onClose={() => setGapOpen(false)} mugs={mugs} onAddWishlist={(d) => { addMany(d); setTab("wishlist"); }} />
      <DealsModal open={!!dealsMug} onClose={() => setDealsMug(null)} mug={dealsMug} />

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="Notifications" subtitle="Get pinged when a wishlisted mug shows up for sale.">
        <div className="grid" style={{ gap: 12 }}>
          <div className="note">The app checks marketplaces for your wishlisted mugs once a day. Enable notifications on this device to get a push when new listings appear — even when the app is closed.</div>
          <button className="primary" onClick={enableNotifications} disabled={notifState === "on"}>{notifState === "on" ? "✓ Notifications enabled" : "🔔 Enable notifications"}</button>
          {notifMsg ? <div className={"note " + (notifState === "on" ? "good" : "warn")}>{notifMsg}</div> : null}
          <div className="help">Searches Tradera and eBay via their official APIs (when configured), plus Blocket, Facebook Marketplace, Arabia and Cervera via Gemini web search. Facebook Marketplace is login-gated, so its coverage is thin. Identification and value estimates also use Gemini. All keys live on the server.</div>
        </div>
      </Modal>
    </div>
  );
}
