"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LANGS, makeT } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import MASTER_CATALOG from "../lib/master-catalog.json";

/* ------------------------------- i18n --------------------------------- */
const I18nContext = createContext(makeT("sv"));
const useT = () => useContext(I18nContext);
// Condition values are stored in English; fall back to the raw value if unknown.
const condLabel = (t, c) => { if (!c) return c; const k = "cond_" + c; const v = t(k); return v === k ? c : v; };

/* ----------------------------- constants ----------------------------- */
const STATUS_VALUES = ["owned", "wishlist", "sold"];
const CONDITIONS = ["New", "Like New", "Very Good", "Good", "Fair", "Poor"];

/* ----------------------------- helpers -------------------------------- */
const normalizeText = (s) => (s || "").toString().trim().toLowerCase();
const foldC = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "").replace(/\bmumin/g, "moomin").replace(/[^a-z0-9]+/g, " ").trim();
const CAT_EUR_SEK = 11.3;
const catSek = (eur) => (eur == null ? null : Math.round((eur * CAT_EUR_SEK) / 10) * 10);
// A picked MASTER_CATALOG entry (EUR) -> normalized entry with SEK values.
const catEntry = (e) => (e ? { num: e.num, nameEn: e.nameEn, year: e.year, capacity: e.capacity, image: e.image, estLow: catSek(e.estLow), estHigh: catSek(e.estHigh) } : null);
const CATALOG_NAMES = new Set(MASTER_CATALOG.map((e) => foldC(e.nameEn)));
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
  const t = useT();
  if (!open) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={"modal" + (wide ? " wide" : "")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="head">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div><h2>{title}</h2>{subtitle ? <div className="help" style={{ marginTop: 6 }}>{subtitle}</div> : null}</div>
            <button className="ghost icon" onClick={onClose} aria-label={t("close")}>✕</button>
          </div>
        </div>
        <div className="body">{children}</div>
        {footer ? <div className="foot">{footer}</div> : null}
      </div>
    </div>
  );
}
function Confidence({ v }) {
  const t = useT();
  if (v == null) return null;
  const pct = Math.round(Number(v) * 100);
  const col = pct >= 75 ? "var(--accent2)" : pct >= 45 ? "var(--gold)" : "var(--danger)";
  return <span className="conf" title={t("conf_title")}><span style={{ width: 8, height: 8, borderRadius: 99, background: col, display: "inline-block" }} /><b>{pct}%</b> {t("conf_sure")}</span>;
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
function ThemeToggle({ theme, setTheme }) {
  const t = useT();
  // `theme` is "light" | "dark" | "system"; resolve what's actually showing.
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  return (
    <button type="button" className="ghost icon" aria-label={isDark ? t("theme_light") : t("theme_dark")} title={isDark ? t("theme_light") : t("theme_dark")}
      onClick={() => setTheme(isDark ? "light" : "dark")}>
      <span style={{ fontSize: 17, lineHeight: 1 }}>{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
}
function LangPicker({ lang, setLang }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  return (
    <div className="langpick" ref={ref}>
      <button type="button" className="ghost icon" aria-label={t("language")} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 19, lineHeight: 1 }}>{cur.flag}</span>
      </button>
      {open ? (
        <div className="langmenu" role="listbox">
          {LANGS.map((l) => (
            <button key={l.code} type="button" role="option" aria-selected={l.code === lang}
              className={"langitem" + (l.code === lang ? " active" : "")}
              onClick={() => { setLang(l.code); setOpen(false); }}>
              <span style={{ fontSize: 18 }}>{l.flag}</span><span>{l.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------- MugPicker ------------------------------- */
// Searchable, catalogue-locked selector: the name can only be a mug in our DB.
function MugPicker({ value, onPick, invalid }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const results = useMemo(() => {
    const f = foldC(q);
    const list = f ? MASTER_CATALOG.filter((e) => foldC(e.nameEn + " " + e.years).includes(f)) : MASTER_CATALOG;
    return list.slice(0, 80);
  }, [q]);
  return (
    <div className="mugpicker" ref={boxRef}>
      <input
        className={invalid ? "invalid" : ""}
        value={open ? q : (value || "")}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder={t("form_name_ph")}
      />
      {open ? (
        <div className="pickmenu">
          {results.length ? results.map((e, i) => (
            <button type="button" key={e.num + "-" + i} className="pickitem" onClick={() => { onPick(e); setOpen(false); setQ(""); }}>
              <span className="pickthumb">{e.image ? <img src={e.image} alt="" /> : <MugMark size={18} />}</span>
              <span className="pickname">{e.nameEn}<span className="pickmeta">{[e.years, e.capacity, e.estLow != null ? `≈ ${catSek(e.estLow)}–${catSek(e.estHigh)} kr` : null].filter(Boolean).join(" · ")}</span></span>
            </button>
          )) : <div className="help" style={{ padding: "10px 12px" }}>{t("no_match")}</div>}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ MugForm ------------------------------- */
function validateMug(m, t) {
  const e = {};
  if (!m.name || !m.name.trim()) e.name = t("err_name");
  if (m.year !== "" && m.year != null) { const y = Number(m.year); if (!Number.isInteger(y) || y < 1900 || y > 2100) e.year = t("err_year"); }
  if (m.price !== "" && m.price != null) { const p = Number(m.price); if (!Number.isFinite(p) || p < 0) e.price = t("err_price"); }
  return e;
}
function MugForm({ open, onClose, initial, onSave, mugs, mode, saving }) {
  const t = useT();
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
      <button onClick={onClose}>{t("cancel")}</button>
      <button className="primary" disabled={saving} onClick={() => {
        const next = { ...d, year: d.year === "" ? "" : Number(d.year), price: d.price === "" ? "" : Number(d.price), acquiredDate: toISODate(d.acquiredDate), tags: tokenizeTags(tagInput) };
        const e = validateMug(next, t);
        // Every added mug must map to a catalogue entry (no free-typed mugs).
        if (mode === "create" && (!next.name || !CATALOG_NAMES.has(foldC(next.name)))) e.name = t("err_pick_catalog");
        setErrors(e); if (Object.keys(e).length) return;
        onSave(next);
      }}>{saving ? <span className="spin" /> : t("save_mug")}</button>
    </>
  );

  return (
    <Modal open={open} title={mode === "edit" ? t("form_edit_title") : t("form_add_title")} subtitle={t("form_subtitle")} onClose={onClose} footer={footer}>
      <div className="grid" style={{ gap: 12 }}>
        {d.photoUrl ? <div className="card" style={{ overflow: "hidden" }}><img src={d.photoUrl} alt="Mug" style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }} /></div> : null}
        {d.aiConfidence != null ? <div className="row" style={{ justifyContent: "space-between" }}><Confidence v={d.aiConfidence} /><span className="help">{t("form_auto_identified")}</span></div> : null}
        {dups.length ? <div className="note warn">{t("form_dup_warn", { list: dups.map((x) => x.name + (x.year ? ` (${x.year})` : "")).join(", ") })}</div> : null}

        <div className="row">
          <div className="field" style={{ flex: 2, minWidth: 200 }}><label>{t("form_name")}</label>
            <MugPicker value={d.name} invalid={!!errors.name} onPick={(e) => up({
              name: e.nameEn,
              year: e.year != null ? e.year : "",
              series: "Arabia Moomin",
              edition: "",
              photoUrl: d.photoUrl || e.image || "",
              estValueLow: d.estValueLow ?? catSek(e.estLow),
              estValueHigh: d.estValueHigh ?? catSek(e.estHigh),
              estValueCurrency: d.estValueCurrency || "SEK",
            })} />
            {errors.name ? <div className="err">{errors.name}</div> : null}
          </div>
          <div className="field" style={{ minWidth: 150 }}><label>{t("form_status")}</label><select value={d.status} onChange={(e) => up({ status: e.target.value })}>{STATUS_VALUES.map((s) => <option key={s} value={s}>{t("status_" + s)}</option>)}</select></div>
        </div>
        <div className="row">
          <div className="field"><label>{t("form_series")}</label><input value={d.series || ""} onChange={(e) => up({ series: e.target.value })} placeholder={t("form_series_ph")} /></div>
          <div className="field"><label>{t("form_edition")}</label><input value={d.edition || ""} onChange={(e) => up({ edition: e.target.value })} placeholder={t("form_edition_ph")} /></div>
        </div>
        <div className="row">
          <div className="field"><label>{t("form_year")}</label><input inputMode="numeric" value={d.year ?? ""} onChange={(e) => up({ year: e.target.value })} placeholder={t("form_year_ph")} />{errors.year ? <div className="err">{errors.year}</div> : null}</div>
          <div className="field"><label>{t("form_condition")}</label><select value={d.condition || "Good"} onChange={(e) => up({ condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{condLabel(t, c)}</option>)}</select></div>
        </div>
        <div className="field"><label>{t("form_condition_notes")}</label><input value={d.conditionNotes || ""} onChange={(e) => up({ conditionNotes: e.target.value })} placeholder={t("form_condition_notes_ph")} /></div>
        <div className="row">
          <div className="field"><label>{t("form_location")}</label><input value={d.location || ""} onChange={(e) => up({ location: e.target.value })} placeholder={t("form_location_ph")} /></div>
          <div className="field"><label>{t("form_acquired")}</label><input type="date" value={toISODate(d.acquiredDate)} onChange={(e) => up({ acquiredDate: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field"><label>{t("form_paid")}</label><input inputMode="decimal" value={d.price ?? ""} onChange={(e) => up({ price: e.target.value })} placeholder={t("form_paid_ph")} />{errors.price ? <div className="err">{errors.price}</div> : null}</div>
          <div className="field"><label>{t("form_currency")}</label><input value={d.currency || ""} onChange={(e) => up({ currency: e.target.value })} placeholder="SEK" /></div>
        </div>
        <div className="row">
          <div className="field"><label>{t("form_est_low")}</label><input inputMode="decimal" value={d.estValueLow ?? ""} onChange={(e) => up({ estValueLow: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" /></div>
          <div className="field"><label>{t("form_est_high")}</label><input inputMode="decimal" value={d.estValueHigh ?? ""} onChange={(e) => up({ estValueHigh: e.target.value === "" ? null : Number(e.target.value) })} placeholder="—" /></div>
          <div className="field" style={{ maxWidth: 120 }}><label>{t("form_val_currency")}</label><input value={d.estValueCurrency || ""} onChange={(e) => up({ estValueCurrency: e.target.value })} placeholder="SEK" /></div>
        </div>
        <div className="field"><label>{t("form_tags")}</label><input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={t("form_tags_ph")} /></div>
        <div className="switch"><span className="mini">{t("form_favorite")}</span><input type="checkbox" checked={!!d.favorite} onChange={(e) => up({ favorite: e.target.checked })} style={{ width: "auto" }} /></div>
        <div className="field">
          <label>{t("form_photo")}</label>
          <div className="row">
            <button type="button" onClick={() => uploadRef.current?.click()}>{t("form_upload")}</button>
            <button type="button" className={d.photoUrl ? "danger" : ""} disabled={!d.photoUrl} onClick={() => up({ photoUrl: "" })}>{t("form_clear")}</button>
            <input className="sr-only" ref={uploadRef} type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const raw = await fileToDataUrl(f); up({ photoUrl: await downscaleImage(raw) }); e.target.value = ""; }} />
          </div>
        </div>
        <div className="field"><label>{t("form_notes")}</label><textarea value={d.notes || ""} onChange={(e) => up({ notes: e.target.value })} placeholder={t("form_notes_ph")} /></div>
      </div>
    </Modal>
  );
}

/* ------------------------------ ScanModal ----------------------------- */
function ScanModal({ open, onClose, onAddOne, onAddMany, onManual, mugs }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [camLive, setCamLive] = useState(false);
  const [camTried, setCamTried] = useState(false);
  const camRef = useRef(null), fileRef = useRef(null), videoRef = useRef(null), streamRef = useRef(null);

  const stopCam = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamLive(false);
  };
  const startCam = async () => {
    setCamTried(true);
    if (!navigator.mediaDevices?.getUserMedia) { setCamLive(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      setCamLive(true);
    } catch { setCamLive(false); }
  };

  // Reset on open; start the viewfinder when we're on the capture screen; always release the camera on close.
  useEffect(() => {
    if (open) { setBusy(false); setError(""); setItems([]); setPhotoUrl(""); setCamTried(false); }
    else stopCam();
    return () => stopCam();
  }, [open]);
  useEffect(() => {
    if (open && !items.length && !busy) startCam();
    else stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length, busy]);
  const process = async (small) => {
    setBusy(true); setItems([]); setPhotoUrl(small);
    try {
      // Detect every mug in the photo; each is resolved to a catalogue entry server-side.
      const { drafts } = await api("/api/shelf-scan", { method: "POST", body: JSON.stringify({ imageDataUrl: small }) });
      if (!drafts.length) { setError(t("scan_no_mugs")); return; }
      if (drafts.length === 1) {
        // Single mug: open the review form pre-filled from the catalogue match (keep her photo).
        const d0 = drafts[0], e = d0.catalog;
        const initial = e
          ? { ...blankMug(), name: e.nameEn, series: "Arabia Moomin", year: e.year ?? "", condition: d0.condition || "Good", conditionNotes: d0.conditionNotes || "", photoUrl: small, estValueLow: e.estLow, estValueHigh: e.estHigh, estValueCurrency: "SEK", aiConfidence: d0.aiConfidence }
          : { ...blankMug(), name: "", series: "Arabia Moomin", condition: d0.condition || "Good", conditionNotes: d0.conditionNotes || "", photoUrl: small, aiConfidence: d0.aiConfidence };
        onAddOne(initial); onClose(); return;
      }
      setItems(drafts.map((d) => ({ draft: d, checked: d.isMoominMug !== false && !!d.catalog, position: d.position || "", entry: d.catalog || null })));
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const run = async (file) => {
    setError("");
    if (!file) return;
    const raw = await fileToDataUrl(file);
    await process(await downscaleImage(raw, 1400, 0.85));
  };
  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setError("");
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    let dataUrl; try { dataUrl = c.toDataURL("image/jpeg", 0.9); } catch { return; }
    stopCam();
    await process(await downscaleImage(dataUrl, 1400, 0.85));
  };

  const setEntry = (i, entry) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, entry, checked: it.checked || !!entry } : it)));
  const chosen = items.filter((it) => it.checked && it.entry).length;
  const footer = items.length ? (
    <>
      <button onClick={() => { setItems([]); setPhotoUrl(""); }}>{t("scan_rescan")}</button>
      <button className="primary" disabled={!chosen} onClick={() => {
        onAddMany(items.filter((it) => it.checked && it.entry).map((it) => ({
          ...blankMug(), name: it.entry.nameEn, series: "Arabia Moomin", year: it.entry.year ?? "", status: "owned",
          condition: it.draft.condition || "Good", conditionNotes: it.draft.conditionNotes || "",
          photoUrl: it.entry.image || "", estValueLow: it.entry.estLow, estValueHigh: it.entry.estHigh, estValueCurrency: "SEK",
          aiConfidence: it.draft.aiConfidence ?? null,
        })));
        onClose();
      }}>{t("scan_add", { n: chosen, noun: chosen === 1 ? t("mug_one") : t("mug_other") })}</button>
    </>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} wide title={t("scan_title")} subtitle={t("scan_subtitle")} footer={footer}>
      {!items.length && !busy ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="vfwrap">
            <video ref={videoRef} className="viewfinder" playsInline muted autoPlay style={{ display: camLive ? "block" : "none" }} />
            {camLive ? (
              <button className="vfcapture" onClick={capture} aria-label={t("scan_capture_aria")} />
            ) : (
              <div className="vfplaceholder">
                {!camTried ? <span className="spin" /> : <MugMark size={40} />}
                <div className="help" style={{ marginTop: 10 }}>{!camTried ? t("scan_starting_cam") : t("scan_cam_blocked")}</div>
              </div>
            )}
          </div>
          <div className="row">
            {!camLive ? <button className="primary" style={{ flex: 1, justifyContent: "center", padding: "13px" }} onClick={() => camRef.current?.click()}>{t("scan_take_photo")}</button> : null}
            <button style={{ flex: 1, justifyContent: "center", padding: "13px" }} onClick={() => fileRef.current?.click()}>{t("scan_choose_image")}</button>
            <button style={{ flex: 1, justifyContent: "center", padding: "13px" }} onClick={() => { stopCam(); onManual(); }}>{t("scan_add_manual")}</button>
          </div>
          <input className="sr-only" ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; run(f); e.target.value = ""; }} />
          <input className="sr-only" ref={fileRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; run(f); e.target.value = ""; }} />
          <div className="help">{t("scan_tip")}</div>
        </div>
      ) : null}

      {busy ? <div className="drop"><span className="spin" /> <div style={{ marginTop: 8 }}>{t("scan_looking")}</div></div> : null}
      {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}

      {items.length && !busy ? (
        <div className="grid" style={{ gap: 10, marginTop: error ? 10 : 0 }}>
          {photoUrl ? <div className="card" style={{ overflow: "hidden" }}><img src={photoUrl} alt="scan" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} /></div> : null}
          {items.map((it, i) => {
            const e = it.entry;
            const dups = e ? findDuplicates({ name: e.nameEn, year: e.year }, mugs || []) : [];
            return (
              <div className="scanrow" key={i}>
                <input type="checkbox" checked={it.checked && !!e} disabled={!e} onChange={(ev) => setItems((list) => list.map((x, idx) => (idx === i ? { ...x, checked: ev.target.checked } : x)))} style={{ width: "auto", marginTop: 4 }} />
                <div className="scanthumb">
                  {e?.image ? <img src={e.image} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <MugMark size={22} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MugPicker value={e?.nameEn || ""} invalid={!e} onPick={(m) => setEntry(i, catEntry(m))} />
                    </div>
                    <Confidence v={it.draft.aiConfidence} />
                  </div>
                  {e ? (
                    <div className="badges" style={{ marginTop: 8 }}>
                      {it.position ? <Badge>📍 {it.position}</Badge> : null}
                      <Badge>{[e.year, e.capacity].filter(Boolean).join(" · ")}</Badge>
                      {it.draft.condition ? <Badge>✓ {condLabel(t, it.draft.condition)}</Badge> : null}
                      {e.estLow != null ? <Badge>💰 ≈ {e.estLow}–{e.estHigh} kr</Badge> : null}
                      {dups.length ? <Badge kind="fav">{t("scan_possible_dup")}</Badge> : null}
                    </div>
                  ) : (
                    <div className="mini" style={{ marginTop: 6 }}>{t("scan_pick_hint", { name: it.draft.name || "?" })}</div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="help">{t("scan_found", { n: items.length })}</div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------ GapFinder ----------------------------- */
function GapFinder({ open, onClose, mugs, onAddWishlist }) {
  const t = useT();
  const [series, setSeries] = useState("Arabia Moomin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null);
  const [cat, setCat] = useState(null);       // full catalogue (array) or null
  const [catBusy, setCatBusy] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [catQuery, setCatQuery] = useState("");
  useEffect(() => { if (open) { setBusy(false); setError(""); setRows(null); setCat(null); setCatQuery(""); } }, [open]);
  const ownedNames = useMemo(() => new Set(mugs.filter((m) => m.status !== "wishlist").map((m) => normalizeText(m.name))), [mugs]);
  // A tight key: fold, drop filler words, ignore spacing — so "Snufkin" matches
  // "Snufkin" (and "Too-Ticky" == "Tooticky") but NOT "POP Snufkin" / "ABC Snufkin".
  const OWN_STOP = new Set(["and", "the", "with", "of", "in", "on", "a", "x", "mug"]);
  const ownKey = (s) => foldC(s).split(" ").filter((x) => x && !OWN_STOP.has(x)).join("");
  const ownedKeys = useMemo(() => new Set(mugs.filter((m) => m.status !== "wishlist").map((m) => ownKey(m.name)).filter(Boolean)), [mugs]);
  const isOwned = (nameEn) => { const k = ownKey(nameEn); return k !== "" && ownedKeys.has(k); };

  const run = async () => {
    setError(""); setBusy(true); setRows(null);
    try {
      const { catalog } = await api("/api/gaps", { method: "POST", body: JSON.stringify({ series: series.trim() }) });
      if (!catalog.length) setError(t("gap_no_results"));
      setRows(catalog.map((c) => ({ ...c, owned: ownedNames.has(normalizeText(c.character)) })));
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  const loadCatalogue = async () => {
    setError(""); setCatBusy(true);
    try {
      const { catalog } = await api("/api/catalog/list");
      setCat(catalog.map((e) => ({ ...e, owned: isOwned(e.nameEn) })));
    } catch (err) { setError(err.message || String(err)); }
    finally { setCatBusy(false); }
  };

  const draftFrom = (e) => ({ ...blankMug(), name: e.nameEn, series: "Arabia Moomin", year: e.year != null ? e.year : "", status: "wishlist", photoUrl: e.image || "", estValueLow: e.estLow ?? null, estValueHigh: e.estHigh ?? null, estValueCurrency: e.estCur || "EUR" });

  const missing = (rows || []).filter((r) => !r.owned);
  const catMissing = (cat || []).filter((e) => !e.owned);
  const catShown = (cat || []).filter((e) => (!onlyMissing || !e.owned) && (!catQuery || foldC(e.nameEn).includes(foldC(catQuery))));

  const footer = cat ? (
    <>
      <button onClick={() => setCat(null)}>{t("gap_new_search")}</button>
      <button className="primary" disabled={!catMissing.length} onClick={() => { onAddWishlist(catMissing.map(draftFrom)); onClose(); }}>{t("gap_wishlist_missing_all", { n: catMissing.length })}</button>
    </>
  ) : rows ? (
    <>
      <button onClick={() => setRows(null)}>{t("gap_new_search")}</button>
      <button className="primary" disabled={!missing.length} onClick={() => {
        const drafts = missing.map((r) => ({ ...blankMug(), name: r.character, series, edition: r.edition || "", year: r.year != null ? r.year : "", status: "wishlist", notes: r.notes || "" }));
        onAddWishlist(drafts); onClose();
      }}>{t("gap_wishlist_missing", { n: missing.length })}</button>
    </>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} wide title={cat ? t("gap_cat_title") : t("gap_title")} subtitle={cat ? "" : t("gap_subtitle")} footer={footer}>
      {cat ? (
        <div className="grid" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}><input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder={t("search_ph")} /></div>
            <div className="switch"><span className="mini">{t("gap_only_missing")}</span><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} style={{ width: "auto" }} /></div>
          </div>
          <div className="help">{t("gap_cat_summary", { owned: cat.filter((e) => e.owned).length, total: cat.length, missing: catMissing.length })}</div>
          {catShown.map((e, i) => (
            <div className="scanrow" key={i} style={{ opacity: e.owned ? 0.55 : 1, alignItems: "center" }}>
              <div className="scanthumb">{e.image ? <img src={e.image} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <MugMark size={22} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mugname" style={{ fontSize: 14 }}>{e.nameEn}</div>
                <div className="mini">{[e.years, e.capacity, (e.estLow != null ? `≈ ${e.estLow}–${e.estHigh} ${e.estCur}` : null)].filter(Boolean).join(" · ")}</div>
              </div>
              {e.owned ? <Badge kind="owned">{t("gap_in_collection")}</Badge>
                : <button onClick={() => onAddWishlist([draftFrom(e)])}>{t("gap_wish")}</button>}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="row">
            <div className="field" style={{ flex: 1 }}><label>{t("gap_series_label")}</label><input value={series} onChange={(e) => setSeries(e.target.value)} placeholder={t("gap_series_ph")} /></div>
            <button className="primary" onClick={run} disabled={busy} style={{ alignSelf: "flex-end" }}>{busy ? <span className="spin" /> : t("gap_search")}</button>
          </div>
          <button onClick={loadCatalogue} disabled={catBusy} style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>{catBusy ? <span className="spin" /> : `📖 ${t("gap_browse")}`}</button>
          {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}
          {rows ? (
            <div className="grid" style={{ gap: 8, marginTop: 12 }}>
              <div className="help">{t("gap_summary", { owned: rows.filter((r) => r.owned).length, missing: missing.length, total: rows.length })}</div>
              {rows.map((r, i) => (
                <div className="listrow" key={i} style={{ opacity: r.owned ? 0.6 : 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{r.owned ? "✓ " : ""}{r.character}{r.year ? <span className="muted"> · {r.year}</span> : null}</div>
                    {r.edition || r.notes ? <div className="mini">{[r.edition, r.notes].filter(Boolean).join(" — ")}</div> : null}
                  </div>
                  <Badge kind={r.owned ? "owned" : "wishlist"}>{r.owned ? t("gap_owned") : t("gap_missing")}</Badge>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------ DealsModal ---------------------------- */
function DealsModal({ open, onClose, mug }) {
  const t = useT();
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
    <Modal open={open} onClose={onClose} wide title={mug ? t("deals_find_title", { name: mug.name }) : t("deals_find_default")} subtitle={t("deals_subtitle")} footer={<button className="primary" onClick={run} disabled={busy}>{busy ? <span className="spin" /> : t("deals_search_again")}</button>}>
      {busy && !listings.length ? <div className="drop"><span className="spin" /><div style={{ marginTop: 8 }}>{t("deals_searching")}</div></div> : null}
      {error ? <div className="err">{error}</div> : null}

      {listings.length ? (
        <div className="grid" style={{ gap: 8 }}>
          <div className="help">{t("deals_live_count", { n: listings.length, noun: listings.length === 1 ? t("listing_one") : t("listing_other") })}</div>
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
              <div className="help">{t("deals_web_sources")}</div>
              {web.sources.map((s, i) => <a className="srcitem" key={i} href={s.uri} target="_blank" rel="noopener noreferrer"><span className="link">{s.title}</span></a>)}
            </div>
          ) : null}
        </div>
      ) : null}

      {!busy && !listings.length && !web?.sources?.length ? <div className="help">{t("deals_none")}</div> : null}
    </Modal>
  );
}

/* ------------------------------- MugCard ------------------------------ */
function MugCard({ m, onEdit, onDelete, onFav, onDeals }) {
  const t = useT();
  const val = (m.estValueLow != null || m.estValueHigh != null)
    ? `${formatMoney(m.estValueLow ?? m.estValueHigh, m.estValueCurrency || "SEK")}${m.estValueLow != null && m.estValueHigh != null ? "–" + formatMoney(m.estValueHigh, m.estValueCurrency || "SEK") : ""}`
    : "";
  const dealCount = m.listings?.length || 0;
  return (
    <div className="card mug">
      <div className="mugphoto">
        {m.photoUrl ? <img src={m.photoUrl} alt={m.name} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span className="ph"><MugMark size={46} /></span>}
        <div className="abschip">
          <Badge kind={m.status}>{t("status_" + m.status)}</Badge>
          {m.favorite ? <Badge kind="fav">★</Badge> : null}
        </div>
      </div>
      <div className="mugbody">
        <div className="mugname" title={m.name}>{m.name || t("card_untitled")}</div>
        <div className="sub">{[m.series || "—", m.year, m.edition].filter(Boolean).join(" · ")}</div>
        <div className="badges">
          {m.condition ? <Badge>✓ {condLabel(t, m.condition)}</Badge> : null}
          {m.price !== "" && m.price != null ? <Badge>💰 {formatMoney(m.price, m.currency || "SEK")}</Badge> : null}
          {val ? <Badge title={t("card_est_title")}>≈ {val}</Badge> : null}
          {m.location ? <Badge>📍 {m.location}</Badge> : null}
          {m.status === "wishlist" && dealCount ? <Badge kind="deal">{t("card_found", { n: dealCount })}</Badge> : null}
        </div>
        {m.tags?.length ? <div className="badges">{m.tags.slice(0, 6).map((t) => <span key={t} className="chip">#{t}</span>)}</div> : null}
        {m.conditionNotes ? <div className="mini lineclamp">{m.conditionNotes}</div> : null}
        {m.notes ? <div className="mini lineclamp">{m.notes}</div> : null}
        <div className="mugfoot">
          {m.status === "wishlist" ? <button onClick={() => onDeals(m)}>{t("card_deals")}</button> : <button onClick={() => onFav(m)}>{m.favorite ? "★" : "☆"} {t("card_fav")}</button>}
          <button onClick={() => onEdit(m)}>{t("card_edit")}</button>
          <button className="danger" onClick={() => onDelete(m)}>{t("card_delete")}</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- App --------------------------------- */
export default function App() {
  const [lang, setLang] = useState("sv");
  const [theme, setTheme] = useState("system"); // system | light | dark
  const t = useMemo(() => makeT(lang), [lang]);

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
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMsg, setCatalogMsg] = useState("");

  const load = async () => {
    setLoading(true); setLoadError("");
    try { const { mugs } = await api("/api/mugs"); setMugs(mugs); ensureImages(mugs); }
    catch (e) { setLoadError(e.message || String(e)); }
    finally { setLoading(false); }
  };
  // Silent re-sync from the server (no loading flash) — used after adds.
  const reload = async () => { try { const { mugs } = await api("/api/mugs"); setMugs(mugs); ensureImages(mugs); } catch { /* ignore */ } };
  // Backfill product images for mugs that don't have a photo yet, one at a
  // time so we're gentle on the search sources. Saved server-side (quietly).
  const ensureImages = async (list) => {
    const targets = (list || []).filter((m) => m && m.id && m.name && (!m.photoUrl || m.year == null || (m.estValueLow == null && m.estValueHigh == null)));
    for (const m of targets) {
      try {
        const { imageUrl, year, value } = await api("/api/mug-image", { method: "POST", body: JSON.stringify({ id: m.id, name: m.name, series: m.series, year: m.year, edition: m.edition }) });
        setMugs((prev) => prev.map((x) => {
          if (x.id !== m.id) return x;
          const n = { ...x };
          if (imageUrl && !n.photoUrl) n.photoUrl = imageUrl;
          if (year && n.year == null) n.year = year;
          if (value && n.estValueLow == null && n.estValueHigh == null) { n.estValueLow = value.low; n.estValueHigh = value.high; n.estValueCurrency = value.cur; }
          return n;
        }));
      } catch { /* ignore — the card keeps its placeholder */ }
    }
  };
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "wishlist") setTab("wishlist");
    // Restore the saved language preference (Swedish by default).
    try { const saved = localStorage.getItem("lang"); if (saved === "sv" || saved === "en") setLang(saved); } catch { /* ignore */ }
    // Restore the saved theme preference (follows the system by default).
    try { const th = localStorage.getItem("theme"); if (th === "light" || th === "dark") setTheme(th); } catch { /* ignore */ }
    // Register the service worker so the app is an installable PWA.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { if (theme === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const saveMug = async (next) => {
    setSaving(true);
    try {
      if (next.id && mugs.some((m) => m.id === next.id)) {
        const { mug } = await api(`/api/mugs/${next.id}`, { method: "PATCH", body: JSON.stringify(next) });
        setMugs((prev) => prev.map((m) => (m.id === mug.id ? mug : m)));
      } else {
        const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(next) });
        setMugs((prev) => [mug, ...prev]);
        if (!mug.photoUrl) ensureImages([mug]);
      }
      setFormOpen(false);
    } catch (e) { alert(t("save_failed", { msg: e.message || e })); }
    finally { setSaving(false); }
  };
  const addMany = async (drafts) => {
    try {
      const created = [];
      for (const d of drafts) { const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(d) }); created.push(mug); }
      setMugs((prev) => [...created, ...prev]);
      ensureImages(created);
    } catch (e) { alert(t("add_failed", { msg: e.message || e })); }
  };
  const del = async (m) => {
    if (!confirm(t("confirm_delete", { name: m.name }))) return;
    try { await api(`/api/mugs/${m.id}`, { method: "DELETE" }); setMugs((prev) => prev.filter((x) => x.id !== m.id)); }
    catch (e) { alert(t("delete_failed", { msg: e.message || e })); }
  };
  const fav = async (m) => {
    const optimistic = !m.favorite;
    setMugs((prev) => prev.map((x) => (x.id === m.id ? { ...x, favorite: optimistic } : x)));
    try { await api(`/api/mugs/${m.id}`, { method: "PATCH", body: JSON.stringify({ favorite: optimistic }) }); }
    catch { setMugs((prev) => prev.map((x) => (x.id === m.id ? { ...x, favorite: !optimistic } : x))); }
  };

  const fillCatalog = async () => {
    setCatalogBusy(true); setCatalogMsg("");
    try {
      const r = await api("/api/catalog", { method: "POST" });
      if (r.count) { setCatalogMsg(t("catalog_done", { count: r.count })); reload(); }
      else {
        const detail = (r.stores || []).map((s) => `${s.domain}: ${s.error || s.mugs + " mugs"}`).join("; ") || "—";
        setCatalogMsg(t("catalog_none", { detail }));
      }
    } catch (e) { setCatalogMsg(e.message || String(e)); }
    finally { setCatalogBusy(false); }
  };

  const openCreate = () => { setFormInitial(blankMug()); setFormMode("create"); setFormOpen(true); };
  const openEdit = (m) => { setFormInitial({ ...m }); setFormMode("edit"); setFormOpen(true); };
  const openReview = (draft) => { setFormInitial({ ...draft }); setFormMode("create"); setFormOpen(true); };

  const enableNotifications = async () => {
    setNotifMsg("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setNotifState("unsupported"); setNotifMsg(t("notif_unsupported")); return; }
      const { publicKey } = await api("/api/push/vapid");
      if (!publicKey) { setNotifState("error"); setNotifMsg(t("notif_no_vapid")); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setNotifState("error"); setNotifMsg(t("notif_denied")); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
      setNotifState("on"); setNotifMsg(t("notif_enabled_msg"));
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
    { k: "collection", label: t("tab_collection") },
    { k: "wishlist", label: `${t("tab_wishlist")}${stats.wishlist ? ` (${stats.wishlist})` : ""}` },
    { k: "stats", label: t("tab_stats") },
  ];

  return (
    <I18nContext.Provider value={t}>
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <div className="logo"><MugMark size={26} /></div>
          <div className="title"><h1>{t("app_title")}<span className="ver">v{APP_VERSION}</span></h1><div className="sub">{t("app_tagline")}</div></div>
        </div>
        <div className="actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <LangPicker lang={lang} setLang={setLang} />
          <button className="primary hide-mobile" onClick={() => setScanOpen(true)}>{t("scan")}</button>
          <button className="hide-mobile" onClick={() => setGapOpen(true)}>{t("gaps_btn")}</button>
          <button className="ghost icon hide-mobile" title={t("notif_about_aria")} onClick={() => setAboutOpen(true)}>🔔</button>
        </div>
      </div>

      {loadError ? <div className="note warn" style={{ marginBottom: 12 }}>{t("load_error", { msg: loadError })}</div> : null}

      <div className="tabs hide-mobile">{TABS.map((tb) => <button key={tb.k} className={"tabbtn " + (tab === tb.k ? "active" : "")} onClick={() => setTab(tb.k)}>{tb.label}</button>)}</div>

      {tab !== "stats" ? (
        <>
          <div className="card pad" style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 2, minWidth: 180 }}><label>{t("search")}</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search_ph")} /></div>
              <button type="button" className="only-mobile" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>{filtersOpen ? "▲ " : "▾ "}{t("filters")}</button>
            </div>
            <div className={"row filterfields" + (filtersOpen ? " open" : "")} style={{ marginTop: 10 }}>
              {tab === "collection" ? (
                <div className="field" style={{ minWidth: 150 }}><label>{t("filter_status")}</label><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">{t("filter_all")}</option>{STATUS_VALUES.map((s) => <option key={s} value={s}>{t("status_" + s)}</option>)}</select></div>
              ) : null}
              <div className="field" style={{ minWidth: 170 }}><label>{t("filter_sort")}</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="updated_desc">{t("sort_updated")}</option>
                  <option value="year_desc">{t("sort_year_desc")}</option>
                  <option value="year_asc">{t("sort_year_asc")}</option>
                  <option value="value_desc">{t("sort_value_desc")}</option>
                  <option value="name">{t("sort_name")}</option>
                </select>
              </div>
              <div className="field" style={{ maxWidth: 150 }}><label>{t("filter_favorites")}</label><div className="switch"><span className="mini">{t("filter_star_only")}</span><input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} style={{ width: "auto" }} /></div></div>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <div className="row"><span className="pill">{t("shown", { n: viewMugs.length })}</span><span className="pill">{t("total", { n: mugs.length })}</span></div>
              <div className="row"><button onClick={() => setGapOpen(true)}>{t("gaps_btn")}</button><button onClick={openCreate}>{t("add")}</button></div>
            </div>
          </div>

          {loading ? (
            <div className="card pad"><span className="spin" /> {t("loading")}</div>
          ) : mugs.length === 0 ? (
            <div className="card pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>📷</div>
              <div style={{ fontWeight: 400, fontSize: 20, marginTop: 8 }}>{t("empty_title")}</div>
              <div className="sub" style={{ marginTop: 6 }}>{t("empty_sub")}</div>
              <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
                <button className="primary" onClick={() => setScanOpen(true)}>{t("empty_scan")}</button>
                <button onClick={openCreate}>{t("empty_add_manual")}</button>
              </div>
            </div>
          ) : viewMugs.length === 0 ? (
            <div className="card pad"><div className="muted">{t("no_match")}</div></div>
          ) : (
            <div className="muggrid">{viewMugs.map((m) => <MugCard key={m.id} m={m} onEdit={openEdit} onDelete={del} onFav={fav} onDeals={setDealsMug} />)}</div>
          )}

          {tab === "wishlist" ? <div className="help" style={{ marginTop: 12 }}>{t("wishlist_tip")}</div> : null}
        </>
      ) : (
        <>
          <div className="kpi">
            <div className="card kpicard"><div className="kpilabel">{t("kpi_owned")}</div><div className="kpivalue">{stats.owned}</div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_wishlist")}</div><div className="kpivalue">{stats.wishlist}</div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_favorites")}</div><div className="kpivalue">{stats.favorites}</div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_sold")}</div><div className="kpivalue">{stats.sold}</div></div>
          </div>
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div className="kpilabel">{t("stats_total_paid")}</div><div style={{ fontSize: 26, fontWeight: 300, marginTop: 6 }}>{formatMoney(stats.spent, "SEK")}</div></div>
              <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div className="kpilabel">{t("stats_est_value")}</div><div style={{ fontSize: 26, fontWeight: 300, marginTop: 6 }}>{formatMoney(stats.value, stats.valueCur)}</div><div className="help" style={{ marginTop: 4 }}>{t("stats_est_value_sub")}</div></div>
            </div>
            <div className="card pad">
              <div style={{ fontWeight: 500 }}>{t("stats_by_year")}</div><div className="divider" />
              {stats.byYearData.length ? <div className="list">{stats.byYearData.map((r) => (
                <div key={r.year} className="listrow"><div style={{ fontWeight: 700, width: 52 }}>{r.year}</div><div className="bar"><span style={{ width: `${(r.count / stats.maxYear) * 100}%` }} /></div><span className="pill">{r.count}</span></div>
              ))}</div> : <div className="muted">{t("stats_by_year_empty")}</div>}
            </div>
            <div className="card pad">
              <div style={{ fontWeight: 500 }}>{t("stats_top_chars")}</div><div className="divider" />
              {stats.topChars.length ? <div className="list">{stats.topChars.map((tc) => <div key={tc.name} className="listrow"><div>{tc.name}</div><span className="pill">{tc.count}</span></div>)}</div> : <div className="muted">{t("stats_top_chars_empty")}</div>}
            </div>
          </div>
        </>
      )}

      <nav className="bottomnav">
        <button className={"bn " + (tab === "collection" ? "active" : "")} onClick={() => setTab("collection")}><span className="ic">🗄️</span>{t("nav_collection")}</button>
        <button className={"bn " + (tab === "wishlist" ? "active" : "")} onClick={() => setTab("wishlist")}><span className="ic">♡</span>{t("nav_wishlist")}</button>
        <button className="bn bn-add" onClick={() => setScanOpen(true)} aria-label={t("nav_add_aria")}><span className="ic bn-addic">＋</span>{t("nav_add")}</button>
        <button className={"bn " + (tab === "stats" ? "active" : "")} onClick={() => setTab("stats")}><span className="ic">📊</span>{t("nav_stats")}</button>
        <button className="bn" onClick={() => setAboutOpen(true)}><span className="ic">🔔</span>{t("nav_alerts")}</button>
      </nav>

      <footer className="sitefoot">
        <svg className="wave" viewBox="0 0 1440 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0,26 C180,48 360,6 720,20 C1080,34 1260,48 1440,18 L1440,48 L0,48 Z" /></svg>
        <div className="footinner"><span className="footmark"><MugMark size={20} /></span><span>{t("app_title")}</span></div>
      </footer>

      <MugForm open={formOpen} onClose={() => setFormOpen(false)} initial={formInitial} mode={formMode} mugs={mugs} onSave={saveMug} saving={saving} />
      <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} mugs={mugs} onAddOne={openReview} onAddMany={addMany} onManual={() => { setScanOpen(false); openCreate(); }} />
      <GapFinder open={gapOpen} onClose={() => setGapOpen(false)} mugs={mugs} onAddWishlist={(d) => { addMany(d); setTab("wishlist"); }} />
      <DealsModal open={!!dealsMug} onClose={() => setDealsMug(null)} mug={dealsMug} />

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={t("about_title")} subtitle={t("about_subtitle")}>
        <div className="grid" style={{ gap: 12 }}>
          <div className="note">{t("about_body")}</div>
          <button className="primary" onClick={enableNotifications} disabled={notifState === "on"}>{notifState === "on" ? t("about_enabled") : t("about_enable")}</button>
          {notifMsg ? <div className={"note " + (notifState === "on" ? "good" : "warn")}>{notifMsg}</div> : null}
          <div className="help">{t("about_help")}</div>
          <div className="divider" />
          <div className="note">{t("catalog_about")}</div>
          <button onClick={fillCatalog} disabled={catalogBusy}>{catalogBusy ? <><span className="spin" /> {t("catalog_filling")}</> : t("catalog_fill")}</button>
          {catalogMsg ? <div className="note good">{catalogMsg}</div> : null}
        </div>
      </Modal>
    </div>
    </I18nContext.Provider>
  );
}
