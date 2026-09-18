"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import useEmblaCarousel from "embla-carousel-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Toaster, toast } from "sonner";
import { LANGS, makeT } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import { matchMug, warmUp, isReady, getProgress } from "../lib/image-match";
import { getDeviceId } from "../lib/device";
import { createSearch } from "../lib/search";
import { useRipple, useFlip, animateGhost, useCountUp, useIsoLayoutEffect, useBackToClose } from "../lib/motion";
import MASTER_CATALOG from "../lib/master-catalog.json";
import {
  Sun, Moon, Search, SlidersHorizontal, Sparkles, Camera, Bell, Plus, Heart,
  BarChart3, Pencil, Trash2, Star, MapPin, Coins, CheckCircle2, X,
  ImagePlus, AlertTriangle, BookOpen, Tag, PackageSearch, LayoutGrid, Rows3, LogOut, User, Download, ClipboardCopy,
} from "lucide-react";

/* ------------------------------- i18n --------------------------------- */
const I18nContext = createContext(makeT("sv"));
const useT = () => useContext(I18nContext);
// Current language, so components can localize catalogue names for display.
const LangContext = createContext("sv");
const useLang = () => useContext(LangContext);
// Condition values are stored in English; fall back to the raw value if unknown.
const condLabel = (t, c) => { if (!c) return c; const k = "cond_" + c; const v = t(k); return v === k ? c : v; };

/* ----------------------------- constants ----------------------------- */
const UNDO_MS = 6000; // how long a deleted mug can be restored from its toast
const STATUS_VALUES = ["owned", "wishlist", "sold"];
const CONDITIONS = ["New", "Like New", "Very Good", "Good", "Fair", "Poor"];
const CURRENCIES = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK"];

/* ----------------------------- helpers -------------------------------- */
const normalizeText = (s) => (s || "").toString().trim().toLowerCase();
const foldC = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "").replace(/\bmumin/g, "moomin").replace(/[^a-z0-9]+/g, " ").trim();
const CAT_EUR_SEK = 11.3;
const catSek = (eur) => (eur == null ? null : Math.round((eur * CAT_EUR_SEK) / 10) * 10);
// A picked MASTER_CATALOG entry (EUR) -> normalized entry with SEK values.
const catEntry = (e) => (e ? { num: e.num, nameEn: e.nameEn, year: e.year, capacity: e.capacity, image: e.image, estLow: catSek(e.estLow), estHigh: catSek(e.estHigh) } : null);
const CATALOG_NAMES = new Set(MASTER_CATALOG.map((e) => foldC(e.nameEn)));
// English norm -> Swedish display name. Stored mug names stay English (they drive
// catalogue matching); Swedish is applied only at render when lang === "sv".
const SV_NAMES = new Map(MASTER_CATALOG.filter((e) => e.nameSv).map((e) => [foldC(e.nameEn), e.nameSv]));
const catName = (name, lang) => (lang === "sv" && name ? (SV_NAMES.get(foldC(name)) || name) : name);
// Images reused across differently-named catalogue entries are unreliable (data
// gaps) — never prefer one of those over a user's own photo.
const AMBIGUOUS_IMAGES = (() => {
  const byImg = new Map();
  for (const e of MASTER_CATALOG) { if (!e.image) continue; const s = byImg.get(e.image) || new Set(); s.add(e.nameEn.toLowerCase()); byImg.set(e.image, s); }
  const out = new Set(); for (const [img, names] of byImg) if (names.size > 1) out.add(img); return out;
})();
const reliableImg = (u) => !!u && !AMBIGUOUS_IMAGES.has(u);
// Catalogue photos are now transparent WebP; upgrade any older /mugs/*.jpg paths
// stored on existing mugs so they still resolve.
const mugImg = (u) => (typeof u === "string" ? u.replace(/^(\/mugs\/[^?]+)\.jpg$/i, "$1.webp") : u);
// The stored catalogue image is a mug's default face; a user's own photo (camera
// snapshot or upload) is only a fallback when the name has no catalogue image.
const CATALOG_IMAGE_BY_NAME = new Map(MASTER_CATALOG.filter((e) => e.image).map((e) => [foldC(e.nameEn), e.image]));
const displayImg = (m) => CATALOG_IMAGE_BY_NAME.get(foldC(m?.name)) || mugImg(m?.photoUrl);
// Ownership key: fold + drop filler words + ignore spacing, so "Snufkin" matches
// but "POP Snufkin" doesn't. Stored mugs are keyed by name, so same-named catalogue
// variants share a key — the "add to collection" list shows one entry per name.
const OWN_STOP = new Set(["and", "the", "with", "of", "in", "on", "a", "x", "mug"]);
const ownKey = (s) => foldC(s).split(" ").filter((x) => x && !OWN_STOP.has(x)).join("");
const CATALOG_UNIQUE = (() => { const seen = new Set(), out = []; for (const e of MASTER_CATALOG) { const k = ownKey(e.nameEn); if (k && seen.has(k)) continue; seen.add(k); out.push(e); } return out; })();
// Fuse-backed typo-tolerant search over the catalogue (built once).
const searchMasterCatalog = createSearch(MASTER_CATALOG, { nameEn: (e) => e.nameEn, nameSv: (e) => e.nameSv, years: (e) => e.years });
const searchCatalogUnique = createSearch(CATALOG_UNIQUE, { nameEn: (e) => e.nameEn, nameSv: (e) => e.nameSv, years: (e) => e.years });
const toISODate = (d) => (d ? String(d).slice(0, 10) : "");
// Local YYYY-MM-DD (toISOString would be UTC and can be a day off near midnight).
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
function formatMoney(amount, currency = "SEK") {
  if (amount === "" || amount == null) return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${Math.round(n)} ${currency}`; }
}
// Relative time until a listing ends, e.g. "om 2 d".
function timeLeft(iso, t) {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return t("deal_ended");
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return t("deal_ends_min", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("deal_ends_hour", { n: hours });
  return t("deal_ends_day", { n: Math.round(hours / 24) });
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
// A stable per-device id so an anonymous (not-signed-in) user still has a
// collection. Lost if the browser storage is cleared or the device changes —
// signing in with Google moves it to the account.
// (see lib/device.js)
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "x-device-id": getDeviceId(), ...(opts.headers || {}) } });
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
    conditionNotes: "", location: "", acquiredDate: "", price: "", currency: "SEK", favorite: false, hasTag: false,
    photoUrl: "", estValueLow: null, estValueHigh: null, estValueCurrency: "SEK", notes: "", tags: [], aiConfidence: null };
}
// A ready-to-save draft from a catalogue entry (used by the on-device matcher).
function catalogDraft(e) {
  return { ...blankMug(), name: e.nameEn, series: "Arabia Moomin", year: e.year != null ? e.year : "", status: "owned",
    capacity: e.capacity || "", photoUrl: e.image || "", estValueLow: catSek(e.estLow), estValueHigh: catSek(e.estHigh), estValueCurrency: "SEK" };
}

/* --------------------------- UI primitives ---------------------------- */
function Badge({ children, kind }) { return <span className={"badge " + (kind || "")}>{children}</span>; }
function Modal({ open, title, subtitle, children, onClose, footer, wide, raised }) {
  const t = useT();
  // Swiping back from the screen edge closes the dialog (see useBackToClose).
  useBackToClose(open, () => onClose?.());
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={"overlay" + (raised ? " raised" : "")} />
        <Dialog.Content className={"modal" + (wide ? " wide" : "") + (raised ? " raised" : "")}>
          <div className="head">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
                {subtitle
                  ? <Dialog.Description asChild><div className="help" style={{ marginTop: 6 }}>{subtitle}</div></Dialog.Description>
                  : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
              </div>
              <Dialog.Close asChild><button className="ghost icon" aria-label={t("close")}><X size={18} /></button></Dialog.Close>
            </div>
          </div>
          <div className="body">{children}</div>
          {footer ? <div className="foot">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Confidence({ v }) {
  const t = useT();
  if (v == null) return null;
  const pct = Math.round(Number(v) * 100);
  const col = pct >= 75 ? "var(--accent2)" : pct >= 45 ? "var(--gold)" : "var(--danger)";
  return <span className="conf" title={t("conf_title")}><span style={{ width: 8, height: 8, borderRadius: 99, background: col, display: "inline-block" }} /><b>{pct}%</b> {t("conf_sure")}</span>;
}
// Number that counts up from zero on mount (used by the stats dialog).
function CountUp({ value, format }) {
  const n = useCountUp(value);
  return <>{format ? format(n) : n}</>;
}
// Tab strip with an active underline that slides between tabs.
function Tabs({ tabs, value, onChange }) {
  const ref = useRef(null);
  const [ind, setInd] = useState({ left: 0, width: 0 });
  const sig = tabs.map((tb) => tb.label).join("|");
  const measure = () => {
    const el = ref.current?.querySelector(".tabbtn.active");
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  };
  useIsoLayoutEffect(measure, [value, sig]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return (
    <div className="tabs" ref={ref}>
      {tabs.map((tb) => (
        <button key={tb.k} className={"tabbtn " + (value === tb.k ? "active" : "")} onClick={() => onChange(tb.k)}>{tb.label}</button>
      ))}
      <span className="tabind" aria-hidden="true" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />
    </div>
  );
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
// Empty-state illustration: a little shelf of mugs, in the accent colour.
function MugShelf() {
  return (
    <svg className="emptyart" viewBox="0 0 160 100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 88h144" />
      <path d="M16 88v6M144 88v6" opacity=".45" />
      <path d="M20 58h24v24a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5z" />
      <path d="M44 64h5a6 6 0 0 1 0 12h-5" />
      <path d="M66 44h26v38a5 5 0 0 1-5 5H71a5 5 0 0 1-5-5z" />
      <path d="M92 54h6a6 6 0 0 1 0 12h-6" />
      <path d="M75 34c0 3-3 3-3 6M84 34c0 3-3 3-3 6" opacity=".5" />
      <path d="M112 60h24v22a5 5 0 0 1-5 5h-14a5 5 0 0 1-5-5z" />
      <path d="M136 66h5a6 6 0 0 1 0 12h-5" />
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
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
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
        <span className="t-h3" style={{ lineHeight: 1 }}>{cur.flag}</span>
      </button>
      {open ? (
        <div className="langmenu" role="listbox">
          {LANGS.map((l) => (
            <button key={l.code} type="button" role="option" aria-selected={l.code === lang}
              className={"langitem" + (l.code === lang ? " active" : "")}
              onClick={() => { setLang(l.code); setOpen(false); }}>
              <span className="t-h3">{l.flag}</span><span>{l.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
/* Top-right avatar → menu with account (or sign-in), theme, language. */
function AccountMenu({ user, signedIn, theme, setTheme, lang, setLang, onImport }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches); sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  const initial = (user?.name || user?.email || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div className="langpick" ref={ref}>
      <button type="button" className={"avatarbtn" + (signedIn ? "" : " anon")} aria-haspopup="menu" aria-expanded={open} aria-label={t("account")} onClick={() => setOpen((o) => !o)}>
        {signedIn && user?.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" /> : (signedIn ? <span>{initial}</span> : <User size={18} />)}
      </button>
      {open ? (
        <div className="accountmenu" role="menu">
          {signedIn ? (
            <div className="accthead"><div className="mini">{t("signed_in_as")}</div><div className="acctemail" title={user?.email || user?.name}>{user?.email || user?.name}</div></div>
          ) : (
            <div className="accthead">
              <div style={{ fontWeight: 500 }}>{t("not_signed_in")}</div>
              <div className="mini" style={{ marginTop: 4, whiteSpace: "normal", lineHeight: 1.35 }}>{t("anon_warning")}</div>
              <button type="button" className="primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={() => signIn("google")}>{t("signin_google")}</button>
            </div>
          )}
          <div className="menudiv" />
          <button type="button" className="langitem" role="menuitem" onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? <Sun size={17} /> : <Moon size={17} />}<span>{isDark ? t("theme_light") : t("theme_dark")}</span>
          </button>
          <div className="menudiv" />
          {LANGS.map((l) => (
            <button key={l.code} type="button" role="menuitem" className={"langitem" + (l.code === lang ? " active" : "")} onClick={() => { setLang(l.code); }}>
              <span className="t-h3">{l.flag}</span><span>{l.label}</span>
            </button>
          ))}
          <div className="menudiv" />
          <button type="button" className="langitem" role="menuitem" onClick={() => { setOpen(false); onImport?.(); }}><Download size={17} /><span>{t("account_import")}</span></button>
          {signedIn ? (<>
            <div className="menudiv" />
            <button type="button" className="langitem" role="menuitem" onClick={() => signOut()}><LogOut size={17} /><span>{t("sign_out")}</span></button>
          </>) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------- MugPicker ------------------------------- */
// Searchable, catalogue-locked selector: the name can only be a mug in our DB.
function MugPicker({ value, onPick, invalid }) {
  const t = useT();
  const lang = useLang();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const results = useMemo(() => (q.trim() ? searchMasterCatalog(q) : MASTER_CATALOG).slice(0, 80), [q]);
  return (
    <div className="mugpicker" ref={boxRef}>
      <input
        className={invalid ? "invalid" : ""}
        value={open ? q : (catName(value, lang) || "")}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder={t("form_name_ph")}
      />
      {open ? (
        <div className="pickmenu">
          {results.length ? results.map((e, i) => (
            <button type="button" key={e.num + "-" + i} className="pickitem" onClick={() => { onPick(e); setOpen(false); setQ(""); }}>
              <span className="pickthumb">{e.image ? <img src={e.image} alt="" /> : <MugMark size={18} />}</span>
              <span className="pickname">{catName(e.nameEn, lang)}<span className="pickmeta">{[e.years, e.capacity, e.estLow != null ? `≈ ${catSek(e.estLow)}–${catSek(e.estHigh)} kr` : null].filter(Boolean).join(" · ")}</span></span>
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
// Edit an existing mug: only its personal metadata (identity is fixed).
function MugForm({ open, onClose, initial, onSave, onDelete, saving }) {
  const t = useT();
  const lang = useLang();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState({});
  const [acquired, setAcquired] = useState(false); // wishlist -> collection in this session
  const uploadRef = useRef(null);
  useIsoLayoutEffect(() => { setD(initial); setErrors({}); setAcquired(false); }, [initial, open]);
  // Enable Save only once an editable field actually differs from the mug we opened.
  const dirty = useMemo(() => {
    const keys = ["status", "condition", "acquiredDate", "hasTag", "price", "currency", "favorite", "photoUrl", "notes"];
    const sig = (o) => keys.map((k) => { const v = o?.[k]; return v == null ? "" : String(v); }).join("\u0001");
    return sig(d) !== sig(initial);
  }, [d, initial]);
  if (!d) return null;
  const up = (patch) => setD((x) => ({ ...x, ...patch }));

  // Build a clean record and validate; returns the record or null if invalid.
  const build = () => {
    const next = { ...d, year: d.year === "" ? "" : Number(d.year), price: d.price === "" ? "" : Number(d.price), acquiredDate: toISODate(d.acquiredDate), tags: Array.isArray(d.tags) ? d.tags : [] };
    const e = validateMug(next, t);
    setErrors(e);
    return Object.keys(e).length ? null : next;
  };
  const submit = async () => {
    const next = build();
    if (!next) return;
    await onSave(next);
  };

  // A wishlist mug becomes owned here — the only status change that makes sense.
  const acquire = () => {
    setAcquired(true);
    up({ status: "owned", acquiredDate: d.acquiredDate || toISODate(new Date().toISOString()) });
  };

  // The personal metadata — the only thing editable on an existing mug.
  const metaFields = (
    <>
      <div className="row">
        <div className="field"><label>{t("form_condition")}</label><select value={d.condition || "Good"} onChange={(e) => up({ condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{condLabel(t, c)}</option>)}</select></div>
        <div className="field"><label>{t("form_acquired")}</label><input type="date" value={toISODate(d.acquiredDate)} onChange={(e) => up({ acquiredDate: e.target.value })} /></div>
      </div>
      <div className="switch"><span className="mini">{t("form_has_tag")}</span><input type="checkbox" checked={!!d.hasTag} onChange={(e) => up({ hasTag: e.target.checked })} style={{ width: "auto" }} /></div>
      <div className="row">
        <div className="field"><label>{t("form_paid")}</label><input inputMode="decimal" value={d.price ?? ""} onChange={(e) => up({ price: e.target.value })} placeholder={t("form_paid_ph")} />{errors.price ? <div className="err">{errors.price}</div> : null}</div>
        <div className="field"><label>{t("form_currency")}</label><select value={d.currency || "SEK"} onChange={(e) => up({ currency: e.target.value })}>{[...new Set([...CURRENCIES, d.currency].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      </div>
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
    </>
  );

  const footer = (
    <div className="formactions">
      {onDelete ? <button className="danger big" style={{ marginRight: "auto" }} onClick={() => onDelete(initial)}><Trash2 size={16} /> {t("card_delete")}</button> : null}
      <button className="linkbtn" style={{ marginRight: 0 }} onClick={onClose}>{t("cancel")}</button>
      <button className="primary big" disabled={saving || !dirty} onClick={submit}>{saving ? <span className="spin" /> : t("save")}</button>
    </div>
  );

  return (
    <Modal open={open} title={t("form_edit_title")} subtitle={t("form_edit_subtitle")} onClose={onClose} footer={footer}>
      <div className="grid" style={{ gap: 14 }}>
        {/* An existing mug's identity is fixed — show it, don't edit it. */}
        <div className="editident">
          <div className="editident-photo">{d.photoUrl ? <img src={mugImg(d.photoUrl)} alt={catName(d.name, lang) || "Mug"} /> : <MugMark size={56} />}</div>
          <div style={{ minWidth: 0 }}>
            <div className="t-h2 editident-name">{catName(d.name, lang) || t("card_untitled")}</div>
            <div className="sub" style={{ marginTop: 4 }}>{[d.series, d.year, d.edition].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        {d.status === "wishlist" ? (
          <div className="card pad acquire">
            <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 500 }}>{t("acquire_title")}</div>
                <div className="help" style={{ marginTop: 4 }}>{t("acquire_body")}</div>
              </div>
              <button type="button" className="primary" onClick={acquire}><CheckCircle2 size={16} /> {t("acquire_btn")}</button>
            </div>
          </div>
        ) : null}
        {acquired ? <div className="note good">{t("acquire_note")}</div> : null}

        <div className="grid" style={{ gap: 12 }}>{metaFields}</div>
      </div>
    </Modal>
  );
}

/* --------------------------- AddConfirmModal --------------------------- */
// Shown after picking a mug to add (from a catalogue search or a photo): confirm
// the acquisition details and collector attributes before saving.
function AddConfirmModal({ draft, onCancel, onConfirm, saving }) {
  const t = useT();
  const lang = useLang();
  const [d, setD] = useState(draft);
  const [action, setAction] = useState(""); // which action is saving (save | more)
  // Default the acquisition date to today so the common case is one tap away.
  // Layout effect so the date is filled before the first paint (no flash).
  useIsoLayoutEffect(() => { setD(draft ? { ...draft, acquiredDate: draft.acquiredDate || todayISO() } : draft); }, [draft]);
  if (!d) return null;
  const up = (patch) => setD((x) => ({ ...x, ...patch }));
  const status = d.status === "wishlist" ? "wishlist" : "owned";
  const patch = () => ({
    status,
    acquiredDate: toISODate(d.acquiredDate),
    condition: d.condition || "Good",
    price: d.price === "" || d.price == null ? "" : Number(d.price),
    currency: d.currency || "SEK",
    hasTag: !!d.hasTag,
    notes: d.notes || "",
  });
  const submit = (more) => { setAction(more ? "more" : "save"); onConfirm(patch(), more); };
  const footer = (
    <div className="formactions">
      <button className="linkbtn" onClick={onCancel}>{t("cancel")}</button>
      <button className="big" disabled={saving} onClick={() => submit(true)}>{saving && action === "more" ? <span className="spin" /> : t("add_save_more")}</button>
      <button className="primary big" disabled={saving} onClick={() => submit(false)}>{saving && action === "save" ? <span className="spin" /> : t("save")}</button>
    </div>
  );
  return (
    <Modal open={!!draft} raised title={t("add_confirm_title")} subtitle={t("add_confirm_sub")} onClose={onCancel} footer={footer}>
      <div className="grid" style={{ gap: 14 }}>
        <div className="editident">
          <div className="editident-photo">{d.photoUrl ? <img src={mugImg(d.photoUrl)} alt={catName(d.name, lang) || "Mug"} /> : <MugMark size={56} />}</div>
          <div style={{ minWidth: 0 }}>
            <div className="t-h2 editident-name">{catName(d.name, lang) || t("card_untitled")}</div>
            <div className="sub" style={{ marginTop: 4 }}>{[d.series, d.year, d.edition].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        {d.aiConfidence != null ? <div className="row" style={{ justifyContent: "space-between" }}><Confidence v={d.aiConfidence} /><span className="help">{t("form_auto_identified")}</span></div> : null}

        <section className="formsect">
          <div className="formsect-title">{t("confirm_section_acquisition")}</div>
          <div className="field"><label>{t("form_acquired")}</label><input type="date" value={toISODate(d.acquiredDate)} onChange={(e) => up({ acquiredDate: e.target.value })} /></div>
          <div className="row">
            <div className="field"><label>{t("form_paid")}</label><input inputMode="decimal" value={d.price ?? ""} onChange={(e) => up({ price: e.target.value })} placeholder={t("form_paid_ph")} /></div>
            <div className="field"><label>{t("form_currency")}</label><select value={d.currency || "SEK"} onChange={(e) => up({ currency: e.target.value })}>{[...new Set([...CURRENCIES, d.currency].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
        </section>

        <section className="formsect">
          <div className="formsect-title">{t("confirm_section_attributes")}</div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field"><label>{t("form_condition")}</label><select value={d.condition || "Good"} onChange={(e) => up({ condition: e.target.value })}>{CONDITIONS.map((c) => <option key={c} value={c}>{condLabel(t, c)}</option>)}</select></div>
            <div className="field"><div className="switch"><span className="mini">{t("form_has_tag")}</span><input type="checkbox" checked={!!d.hasTag} onChange={(e) => up({ hasTag: e.target.checked })} style={{ width: "auto" }} /></div></div>
          </div>
          <div className="field"><label>{t("form_notes")}</label><textarea value={d.notes || ""} onChange={(e) => up({ notes: e.target.value })} placeholder={t("form_notes_ph")} style={{ minHeight: 64 }} /></div>
        </section>
      </div>
    </Modal>
  );
}

/* ------------------------------ AddMugModal --------------------------- */
// The add dialog: browse the catalogue (newest shortlisted) and quick-add with
// +/♥, match a photo handed over by the add menu, or review a shelf scan.
function AddMugModal({ open, initialPhoto, onClose, onAddOne, onAddMany, onAddRequest, onQuickAdd, mugs }) {
  const t = useT();
  const lang = useLang();
  const [screen, setScreen] = useState("browse"); // browse | match
  const [q, setQ] = useState("");
  const [added, setAdded] = useState(() => new Map()); // nameEn -> "owned" | "wishlist"
  const [pulsing, setPulsing] = useState(""); // nameEn whose ♥ is popping (wishlist quick-add)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [matches, setMatches] = useState(null); // on-device match candidates
  const [matchData, setMatchData] = useState(null); // { embedding, model, candidates } for feedback
  const [modelPct, setModelPct] = useState(0);
  const [photoUrl, setPhotoUrl] = useState("");
  const addingRef = useRef(false); // guards against double-tapping the quick-add heart
  const photoRef = useRef("");     // last initialPhoto we've started processing

  // Reset on open.
  useEffect(() => {
    if (open) { setBusy(false); setError(""); setItems([]); setMatches(null); setMatchData(null); setPhotoUrl(""); setScreen("browse"); setQ(""); setAdded(new Map()); setPulsing(""); addingRef.current = false; }
  }, [open]);
  // Prefetch the on-device model as soon as the dialog opens, so it's ready by
  // the time a photo is taken (first use downloads ~30 MB, then it's cached).
  useEffect(() => { if (open) warmUp(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setModelPct(getProgress()), 500);
    return () => clearInterval(id);
  }, [open]);

  // Server-side detection + verification (used when the on-device matcher can't
  // run, or for a shelf photo with several mugs).
  const processServer = async (small) => {
    const { drafts } = await api("/api/shelf-scan", { method: "POST", body: JSON.stringify({ imageDataUrl: small }) });
    if (!drafts.length) { setError(t("scan_no_mugs")); return; }
    if (drafts.length === 1) {
      const d0 = drafts[0], e = d0.catalog;
      const initial = e
        ? { ...blankMug(), name: e.nameEn, series: "Arabia Moomin", year: e.year ?? "", condition: d0.condition || "Good", conditionNotes: d0.conditionNotes || "", photoUrl: reliableImg(e.image) ? e.image : small, estValueLow: e.estLow, estValueHigh: e.estHigh, estValueCurrency: "SEK", aiConfidence: d0.aiConfidence, verifyReason: d0.verifyReason }
        : { ...blankMug(), name: "", series: "Arabia Moomin", condition: d0.condition || "Good", conditionNotes: d0.conditionNotes || "", photoUrl: small, aiConfidence: d0.aiConfidence, verifyReason: d0.verifyReason };
      // Keep the dialog open (the confirmation sits above it) so more can be added.
      onAddOne(initial); setScreen("browse"); return;
    }
    setItems(drafts.map((d) => ({ draft: d, checked: d.isMoominMug !== false && !!d.catalog, position: d.position || "", entry: d.catalog || null })));
  };

  // Log a confirmed/corrected match so we accumulate real-photo labels for later
  // fine-tuning. Best-effort and non-blocking.
  const logMatch = (chosen, auto, data, photo) => {
    if (!data || !chosen) return;
    const src = photo || photoUrl;
    (async () => {
      try {
        const thumb = src ? await downscaleImage(src, 256, 0.7) : null;
        await api("/api/match-feedback", { method: "POST", body: JSON.stringify({
          thumb, embedding: data.embedding, model: data.model,
          chosenNum: chosen.num, chosenName: chosen.nameEn, auto, candidates: data.candidates,
        }) });
      } catch { /* best-effort */ }
    })();
  };
  // Match a photo: free on-device retrieval first, server fallback if unavailable.
  const processImage = async (small) => {
    setBusy(true); setError(""); setItems([]); setMatches(null); setMatchData(null); setPhotoUrl(small);
    try {
      try {
        const { candidates, autoMargin, embedding, model } = await matchMug(small, { topK: 4 });
        if (candidates.length) {
          const data = { embedding, model, candidates: candidates.map((c) => c.num) };
          setMatches(candidates); setMatchData(data);
          const [best, second] = candidates;
          if (autoMargin != null && best.logit - second.logit >= autoMargin) {
            const e = MASTER_CATALOG.find((x) => x.num === best.num);
            if (e) { logMatch(best, true, data, small); onAddOne(catalogDraft(e)); setMatches(null); setMatchData(null); setPhotoUrl(""); setScreen("browse"); return; }
          }
          setScreen("match");
          return;
        }
      } catch { /* model unavailable → fall back to the server */ }
      await processServer(small);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  const chooseMatch = (m) => {
    const e = MASTER_CATALOG.find((x) => x.num === m.num);
    if (!e) return;
    logMatch(m, false, matchData);
    // Add via the raised confirmation, then return to the catalogue so the
    // dialog stays open for the next mug.
    onAddOne(catalogDraft(e));
    setMatches(null); setMatchData(null); setPhotoUrl(""); setScreen("browse");
  };
  // A photo handed over by the add menu: process it once per new photo.
  useEffect(() => {
    if (open && initialPhoto && photoRef.current !== initialPhoto) {
      photoRef.current = initialPhoto;
      processImage(initialPhoto);
    }
    if (!open) photoRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPhoto]);

  // Browse list: newest catalogue mugs first, filtered to ones not already owned.
  const ownedKeys = useMemo(() => new Set(mugs.filter((m) => m.status !== "wishlist").map((m) => ownKey(m.name)).filter(Boolean)), [mugs]);
  const wishKeys = useMemo(() => new Set(mugs.filter((m) => m.status === "wishlist").map((m) => ownKey(m.name)).filter(Boolean)), [mugs]);
  const isOwned = (nameEn) => { const k = ownKey(nameEn); return !!k && ownedKeys.has(k); };
  const isWished = (nameEn) => { const k = ownKey(nameEn); return !!k && wishKeys.has(k); };
  const newest = useMemo(() => [...CATALOG_UNIQUE].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0)), []);
  const results = useMemo(() => {
    // Mugs added this session stay visible (marked) and pinned to the top.
    const pinned = CATALOG_UNIQUE.filter((e) => added.has(e.nameEn));
    const searching = !!q.trim();
    const base = searching ? searchCatalogUnique(q) : newest.slice(0, 12);
    const rest = base.filter((e) => {
      if (added.has(e.nameEn)) return false;               // already pinned
      // Hide already-owned mugs from the default list — but keep them when the
      // user searches, so a mug they own is still findable (shown as owned).
      if (!searching && isOwned(e.nameEn)) return false;
      return true;
    });
    return [...pinned, ...rest].slice(0, 80);
  }, [q, ownedKeys, added, newest]);

  const draftFor = (e, status) => ({ ...blankMug(), name: e.nameEn, series: "Arabia Moomin", year: e.year != null ? e.year : "", status,
    capacity: e.capacity || "", photoUrl: e.image || "", estValueLow: catSek(e.estLow), estValueHigh: catSek(e.estHigh), estValueCurrency: "SEK" });
  const add = async (e, status) => {
    // Wishlisting is low-stakes, so skip the confirmation: pop the heart, toast,
    // then mark the row. Owned adds still go through the raised confirm dialog.
    if (status === "wishlist") {
      if (addingRef.current) return;
      addingRef.current = true;
      setPulsing(e.nameEn);
      const created = await onQuickAdd(draftFor(e, "wishlist"));
      window.setTimeout(() => {
        addingRef.current = false;
        setPulsing("");
        if (created) setAdded((m) => { const n = new Map(m); n.set(e.nameEn, "wishlist"); return n; });
      }, 420);
      if (created) toast.success(t("wishlist_added_toast", { name: catName(e.nameEn, lang) }));
      return;
    }
    // Keep the drawer open — the confirmation dialog is raised above it, and the
    // user may want to keep adding more mugs from the list.
    const created = await onAddRequest(draftFor(e, "owned"));
    if (created) setAdded((m) => { const n = new Map(m); n.set(e.nameEn, "owned"); return n; });
  };

  const setEntry = (i, entry) => setItems((list) => list.map((it, idx) => (idx === i ? { ...it, entry, checked: it.checked || !!entry } : it)));
  const chosen = items.filter((it) => it.checked && it.entry).length;
  const reviewFooter = (
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
  );
  // Every stage except the shelf-scan review has a single secondary action: close.
  const closeFooter = (
    <div className="formactions">
      <button className="big" onClick={onClose}>{t("close")}</button>
    </div>
  );
  const footer = items.length ? reviewFooter : closeFooter;
  // Each stage of the dialog fades/slides in when it replaces the previous one.
  const stage = items.length ? "review" : busy ? "busy" : screen;

  return (
    <Modal open={open} onClose={onClose} title={t("scan_title")} subtitle={stage === "browse" ? t("scan_subtitle") : undefined} footer={footer}>
      <div className="addstage" key={stage}>
      {!items.length && !busy && screen === "browse" ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="field searchfield"><Search size={17} className="searchicon" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search_ph")} aria-label={t("search")} />
          </div>
          <div className="help">{q ? t("add_search_hint") : t("add_newest_hint")}</div>
          {results.length === 0 ? (
            <div className="card pad"><div className="muted">{q ? t("no_match") : t("add_mugs_none")}</div></div>
          ) : results.map((e) => {
            const status = added.get(e.nameEn);
            const owned = isOwned(e.nameEn);
            const isPulsing = pulsing === e.nameEn;
            // Keep showing the buttons while the heart pops, even though the mug is
            // already in the wishlist by then.
            const wished = !owned && isWished(e.nameEn) && !isPulsing;
            return (
              <div className="scanrow" key={e.nameEn} style={{ alignItems: "center", opacity: (owned || wished) ? 0.55 : 1 }}>
                <div className="scanthumb">{e.image ? <img src={e.image} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <MugMark size={22} />}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mugname t-label">{catName(e.nameEn, lang)}</div>
                  <div className="mini">{[e.years, e.capacity, (e.estLow != null ? `≈ ${catSek(e.estLow)}–${catSek(e.estHigh)} kr` : null)].filter(Boolean).join(" · ")}</div>
                </div>
                {status
                  ? <Badge kind={status === "wishlist" ? "wishlist" : "owned"}><CheckCircle2 size={14} /> {t(status === "wishlist" ? "added_wishlist" : "added")}</Badge>
                  : owned
                    ? <Badge kind="owned"><CheckCircle2 size={14} /> {t("gap_in_collection")}</Badge>
                    : wished
                      ? <Badge kind="wishlist"><Heart size={14} /> {t("status_wishlist")}</Badge>
                      : <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <button className="addbtn" aria-label={t("add_to_collection")} title={t("add_to_collection")} onClick={() => add(e, "owned")}><Plus size={20} /></button>
                          <button className={"addbtn wish" + (isPulsing ? " popping" : "")} aria-label={t("add_to_wishlist")} title={t("add_to_wishlist")} onClick={() => add(e, "wishlist")}><Heart size={20} fill={isPulsing ? "currentColor" : "none"} /></button>
                        </div>}
              </div>
            );
          })}
        </div>
      ) : null}

      {!items.length && !busy && screen === "match" && matches ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {photoUrl ? <img src={photoUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flex: "none" }} /> : null}
            <div className="help">{t("match_hint")}</div>
          </div>
          <div className="matchgrid">
            {matches.map((m, i) => {
              const e = MASTER_CATALOG.find((x) => x.num === m.num);
              return (
                <div className={"matchcard" + (i === 0 ? " best" : "")} key={m.num} role="button" tabIndex={0}
                  onClick={() => chooseMatch(m)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); chooseMatch(m); } }}>
                  {m.image ? <img src={m.image} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <MugMark size={40} />}
                  <div className="mname" title={catName(m.nameEn, lang)}>{catName(m.nameEn, lang)}</div>
                  <div className="mmeta">{[m.year, e?.capacity].filter(Boolean).join(" · ")}</div>
                  {i === 0 ? <Badge kind="owned">{t("match_best")}</Badge> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {busy ? <div className="drop"><span className="spin" /> <div style={{ marginTop: 8 }}>{t("scan_looking")}</div>{!isReady() ? <div className="help" style={{ marginTop: 8 }}>{modelPct > 0 ? t("match_loading_pct", { pct: Math.round(modelPct) }) : t("match_first_time")}</div> : null}</div> : null}
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
                      {it.position ? <Badge><MapPin size={12} /> {it.position}</Badge> : null}
                      <Badge>{[e.year, e.capacity].filter(Boolean).join(" · ")}</Badge>
                      {it.draft.condition ? <Badge><CheckCircle2 size={12} /> {condLabel(t, it.draft.condition)}</Badge> : null}
                      {e.estLow != null ? <Badge><Coins size={12} /> ≈ {e.estLow}–{e.estHigh} kr</Badge> : null}
                      {dups.length ? <Badge kind="fav"><AlertTriangle size={12} /> {t("scan_possible_dup")}</Badge> : null}
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
      </div>
    </Modal>
  );
}

/* ------------------------------- AddMenu ------------------------------ */
// Material-style context menu that springs from the add FAB (or the header Add
// button): photograph a mug, pick an image, or browse the catalogue.
function AddMenu({ open, onOpenChange, anchorRef, onBrowse, onCamera, onFile }) {
  const t = useT();
  // Trigger the shared hidden inputs synchronously to keep the user gesture, then
  // dismiss the menu while the OS picker takes over.
  const choose = (trigger) => { trigger?.(); onOpenChange(false); };
  const items = [
    { key: "catalog", icon: <Search size={24} />, label: t("add_search_catalog"), onClick: () => { onOpenChange(false); onBrowse(); } },
    { key: "image", icon: <ImagePlus size={24} />, label: t("scan_choose_image"), onClick: () => choose(onFile) },
    { key: "photo", icon: <Camera size={24} />, label: t("scan_take_photo"), onClick: () => choose(onCamera) },
  ];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Portal>
        <Popover.Content className="addmenu" side="top" align="end" sideOffset={16} collisionPadding={16} aria-label={t("nav_add")}>
          <div className="addmenu-surface" role="menu">
            {items.map((it, i) => (
              <button key={it.key} type="button" role="menuitem" className="addmenu-item" style={{ animationDelay: `${i * 35}ms` }} onClick={it.onClick}>
                {it.icon}<span>{it.label}</span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ----------------------------- ImportDialog --------------------------- */
// Migrate a collection from Mukify. The user runs this bookmarklet on mukify.com
// (their session stays in their browser), which copies a JSON export; they paste
// it here and we create the mugs. We never handle their Mukify credentials.
const MUKIFY_CODE = `(async()=>{const E="https://database-prod.mukify.com/graphiql/",Q="query($type:Float,$first:Int!,$offset:Int!){collectionItem(type:$type,first:$first,offset:$offset){totalCount edges{node{boughtPrice boughtDate comment stickered signed misprinted item{nameEnUs basicInfo{name} additionalInfo{field rows{columns}}}}}}}";const g=async v=>{const r=await fetch(E,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:Q,variables:v})}),j=await r.json();if(j.errors)throw Error((j.errors[0]&&j.errors[0].message)||"GraphQL error");return j.data.collectionItem};const all=async t=>{const out=[];let o=0,n=Infinity;while(o<n){const c=await g({type:t,first:100,offset:o});n=c.totalCount;const e=c.edges||[];out.push(...e);o+=e.length;if(!e.length)break}return out};const norm=(x,w)=>{const f={};for(const b of (x.item&&x.item.additionalInfo)||[])for(const r of b.rows||[])for(const c of r.columns||[])(f[b.field]=f[b.field]||[]).push(String(c));const s=Number((f.serial_number||[])[0]);return{serial:isFinite(s)?s:null,name:(x.item&&((x.item.basicInfo&&x.item.basicInfo.name)||x.item.nameEnUs))||null,wishlist:!!w,boughtPrice:x.boughtPrice||null,boughtDate:x.boughtDate||null,comment:x.comment||null,stickered:!!x.stickered,signed:!!x.signed,misprinted:!!x.misprinted}};try{let cur="SEK";try{const m=await fetch(E,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"{me{currency}}"})}),mj=await m.json();cur=(mj.data&&mj.data.me&&mj.data.me.currency)||cur}catch(e){}const owned=(await all(1)).map(x=>norm(x,0)),wish=(await all(2)).map(x=>norm(x,1)),data=JSON.stringify({source:"mukify",currency:cur,items:owned.concat(wish)});try{await navigator.clipboard.writeText(data)}catch(e){window.prompt("Copy this JSON:",data)}alert("Mukify export: "+owned.length+" owned + "+wish.length+" wishlist copied. Paste it into Muminmuggar.")}catch(e){alert("Mukify export failed: "+(e&&e.message?e.message:e)+"\\n\\nMake sure you are logged in and on mukify.com.")}})()`;

function ImportDialog({ open, onClose, onImported }) {
  const t = useT();
  const [mode, setMode] = useState("user"); // user | bookmark | extension
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [extToken, setExtToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [touch, setTouch] = useState(false); // coarse pointer → no bookmarks bar
  // Default to the extension on desktop, the bookmarklet on touch (no toolbar).
  useEffect(() => { if (open) { setMode(touch ? "bookmark" : "extension"); setUsername(""); setText(""); setExtToken(""); setBusy(false); setMsg(""); setErr(""); setCopied(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { setTouch(window.matchMedia("(pointer: coarse)").matches); } catch { /* ignore */ } }, []);
  // Mint a connection token for the browser extension on demand.
  useEffect(() => {
    if (!open || mode !== "extension" || extToken) return;
    let alive = true;
    api("/api/import/token", { method: "POST" })
      .then((r) => { if (alive) setExtToken(r.token); })
      .catch((e) => { if (alive) setErr(t("import_failed", { msg: e.message || e })); });
    return () => { alive = false; };
  }, [open, mode, extToken]);

  const copyCode = async () => {
    const code = "javascript:" + MUKIFY_CODE;
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt(t("import_copy"), code); }
  };
  const copyToken = async () => {
    try { await navigator.clipboard.writeText(extToken); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt(t("import_ext_token"), extToken); }
  };

  const run = async () => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "user") {
        const r = await api("/api/import/mukify-shared", { method: "POST", body: JSON.stringify({ username: username.trim(), types: ["1", "2"] }) });
        if (!r.shared && !r.created && !r.skipped) setErr(t("import_shared_off"));
        else setMsg(t("import_done", { created: r.created, skipped: r.skipped, unmatched: r.unmatched }));
      } else {
        let payload;
        try { payload = JSON.parse(text); } catch { setErr(t("import_bad_json")); return; }
        const items = Array.isArray(payload) ? payload : payload?.items;
        if (!Array.isArray(items) || !items.length) { setErr(t("import_empty")); return; }
        const r = await api("/api/import/mukify", { method: "POST", body: JSON.stringify({ items, currency: payload?.currency }) });
        setMsg(t("import_done", { created: r.created, skipped: r.skipped, unmatched: r.unmatched }));
        setText("");
      }
      onImported?.();
    } catch (e) {
      const m = String(e.message || e);
      if (/public username|AnonymousUser/i.test(m)) setErr(t("import_no_public_username"));
      else if (/No such user/i.test(m)) setErr(t("import_no_user"));
      else setErr(t("import_failed", { msg: m }));
    }
    finally { setBusy(false); }
  };

  const canRun = mode === "user" ? !!username.trim() : mode === "bookmark" ? !!text.trim() : false;
  const footer = (
    <div className="formactions">
      <button className="linkbtn" onClick={onClose}>{t("cancel")}</button>
      {mode !== "extension" ? <button className="primary big" disabled={busy || !canRun} onClick={run}>{busy ? <span className="spin" /> : t("import_btn")}</button> : null}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={t("import_title")} subtitle={t("import_sub")} footer={footer}>
      <div className="grid" style={{ gap: 14 }}>
        <div className="segtabs">
          <button type="button" className={mode === "extension" ? "active" : ""} onClick={() => setMode("extension")}>{t("import_mode_extension")}</button>
          <button type="button" className={mode === "user" ? "active" : ""} onClick={() => setMode("user")}>{t("import_mode_user")}</button>
          <button type="button" className={mode === "bookmark" ? "active" : ""} onClick={() => setMode("bookmark")}>{t("import_mode_bookmark")}</button>
        </div>

        {mode === "extension" ? (
          <>
            <div className="note">{t("import_ext_help")}</div>
            {extToken ? (
              <>
                <div className="field">
                  <label>{t("import_ext_token")}</label>
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <input readOnly value={extToken} onFocus={(e) => e.target.select()}
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--fs-caption)" }} />
                    <button type="button" className="primary" onClick={copyToken} style={{ flex: "none" }}>
                      {copied ? <CheckCircle2 size={16} /> : <ClipboardCopy size={16} />} {copied ? t("import_copied") : t("import_copy")}
                    </button>
                  </div>
                </div>
                <div className="help" style={{ whiteSpace: "pre-line" }}>{t("import_ext_steps")}</div>
              </>
            ) : <div className="help">{t("loading")}</div>}
          </>
        ) : mode === "user" ? (
          <>
            <div className="field">
              <label>{t("import_username")}</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mukify-namn"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
            <div className="help">{t("import_username_hint")}</div>
          </>
        ) : (
          <>
            <div className="note">{t("import_help")}</div>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <button type="button" className="primary" onClick={copyCode}>
                {copied ? <CheckCircle2 size={16} /> : <ClipboardCopy size={16} />} {copied ? t("import_copied") : t("import_copy")}
              </button>
              {!touch ? (
                <a className="bookmarklet" href={"javascript:" + encodeURIComponent(MUKIFY_CODE)} draggable="true" onClick={(e) => e.preventDefault()} title={t("import_drag_hint")}>
                  <Download size={16} /> {t("import_bookmarklet")}
                </a>
              ) : null}
            </div>
            <div className="help" style={{ whiteSpace: "pre-line" }}>{touch ? t("import_steps_mobile") : t("import_steps_desktop")}</div>
            <div className="field">
              <label>{t("import_paste")}</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
                placeholder='{"source":"mukify","items":[...]}'
                style={{ minHeight: 120, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--fs-caption)" }} />
            </div>
          </>
        )}

        {msg ? <div className="note good">{msg}</div> : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
    </Modal>
  );
}

/* ------------------------------ GapFinder ----------------------------- */
function GapFinder({ open, onClose, mugs, onAddWishlist }) {
  const t = useT();
  const lang = useLang();
  const [series, setSeries] = useState("Arabia Moomin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null);
  const [cat, setCat] = useState(null);       // full catalogue (array) or null
  const [catBusy, setCatBusy] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [catQuery, setCatQuery] = useState("");
  // Open straight into the browsable catalogue (search + add mugs you don't own).
  useEffect(() => { if (open) { setBusy(false); setError(""); setRows(null); setCat(null); setCatQuery(""); loadCatalogue(); } }, [open]);
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
  const catFiltered = (cat || []).filter((e) => !onlyMissing || !e.owned);
  const searchCat = useMemo(() => createSearch(catFiltered, { nameEn: (e) => e.nameEn, sv: (e) => catName(e.nameEn, "sv") }), [cat, onlyMissing]);
  const catShown = catQuery.trim() ? searchCat(catQuery) : catFiltered;

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
                <div className="mugname t-label">{catName(e.nameEn, lang)}</div>
                <div className="mini">{[e.years, e.capacity, (e.estLow != null ? `≈ ${e.estLow}–${e.estHigh} ${e.estCur}` : null)].filter(Boolean).join(" · ")}</div>
              </div>
              {e.owned ? <Badge kind="owned">{t("gap_in_collection")}</Badge>
                : <button onClick={() => onAddWishlist([draftFrom(e)])}>{t("gap_wish")}</button>}
            </div>
          ))}
        </div>
      ) : catBusy ? (
        <div className="card pad" style={{ textAlign: "center", border: "none", boxShadow: "none" }}><span className="spin" /> {t("loading")}</div>
      ) : (
        <>
          <div className="row">
            <div className="field" style={{ flex: 1 }}><label>{t("gap_series_label")}</label><input value={series} onChange={(e) => setSeries(e.target.value)} placeholder={t("gap_series_ph")} /></div>
            <button className="primary" onClick={run} disabled={busy} style={{ alignSelf: "flex-end" }}>{busy ? <span className="spin" /> : t("gap_search")}</button>
          </div>
          <button onClick={loadCatalogue} disabled={catBusy} style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>{catBusy ? <span className="spin" /> : <><BookOpen size={16} /> {t("gap_browse")}</>}</button>
          {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}
          {rows ? (
            <div className="grid" style={{ gap: 8, marginTop: 12 }}>
              <div className="help">{t("gap_summary", { owned: rows.filter((r) => r.owned).length, missing: missing.length, total: rows.length })}</div>
              {rows.map((r, i) => (
                <div className="listrow" key={i} style={{ opacity: r.owned ? 0.6 : 1 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>{r.owned ? <CheckCircle2 size={14} /> : null}{r.character}{r.year ? <span className="muted"> · {r.year}</span> : null}</div>
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
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listings, setListings] = useState([]);
  const [sources, setSources] = useState(null);
  useEffect(() => {
    if (open && mug) { setError(""); setSources(null); setListings(mug.listings || []); run(); }
  }, [open, mug?.id]);

  const run = async () => {
    setError(""); setBusy(true);
    try {
      const j = await api("/api/deals", { method: "POST", body: JSON.stringify({ mugId: mug.id }) });
      setListings(j.listings?.length ? j.listings : (mug.listings || []));
      setSources(j.sources || null);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };

  const sourceNames = sources ? [sources.tradera ? "Tradera" : null].filter(Boolean) : [];

  return (
    <Modal open={open} onClose={onClose} wide title={mug ? t("deals_find_title", { name: catName(mug.name, lang) }) : t("deals_find_default")} subtitle={t("deals_subtitle")} footer={<button className="primary" onClick={run} disabled={busy}>{busy ? <span className="spin" /> : t("deals_search_again")}</button>}>
      {sourceNames.length ? <div className="help" style={{ marginBottom: 10 }}>{t("deals_sources", { list: sourceNames.join(" · ") })}</div> : null}
      {busy && !listings.length ? <div className="drop"><span className="spin" /><div style={{ marginTop: 8 }}>{t("deals_searching")}</div></div> : null}
      {error ? <div className="err">{error}</div> : null}

      {listings.length ? (
        <div className="grid" style={{ gap: 8 }}>
          <div className="help">{t("deals_live_count", { n: listings.length, noun: listings.length === 1 ? t("listing_one") : t("listing_other") })}</div>
          {listings.map((l, i) => {
            const cur = l.currency || "SEK";
            const primary = l.currentBid != null ? { kind: "bid", amount: l.currentBid }
              : l.buyItNow != null ? { kind: "buy", amount: l.buyItNow }
              : l.startPrice != null ? { kind: "start", amount: l.startPrice }
              : l.price != null ? { kind: "price", amount: l.price } : null;
            const secondary = l.currentBid != null && l.buyItNow != null ? { kind: "buy", amount: l.buyItNow } : null;
            const meta = [l.endDate ? timeLeft(l.endDate, t) : null, l.bidCount ? t("deal_bids_count", { n: l.bidCount }) : null].filter(Boolean).join(" · ");
            return (
              <a className="dealrow" key={i} href={l.url} target="_blank" rel="noopener noreferrer">
                <div className="dealrow-thumb">
                  {l.imageUrl ? <img src={l.imageUrl} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <MugMark size={24} />}
                </div>
                <div className="dealrow-main">
                  <div className="dealrow-title" title={l.title}>{l.title}</div>
                  {primary ? (
                    <div className="dealrow-price">
                      <span className="dealrow-price-main">{t("deal_" + primary.kind)} {formatMoney(primary.amount, cur)}</span>
                      {secondary ? <span className="dealrow-price-alt">{t("deal_" + secondary.kind)} {formatMoney(secondary.amount, cur)}</span> : null}
                    </div>
                  ) : null}
                  {meta ? <div className="mini dealrow-foot">{meta}</div> : null}
                </div>
              </a>
            );
          })}
        </div>
      ) : null}

      {!busy && !listings.length ? <div className="help">{t("deals_none")}</div> : null}
    </Modal>
  );
}

/* ------------------------------- MugCard ------------------------------ */
function MugCard({ m, onEdit, onFav, onDeals }) {
  const t = useT();
  const lang = useLang();
  const displayName = catName(m.name, lang);
  const val = (m.estValueLow != null || m.estValueHigh != null)
    ? `${formatMoney(m.estValueLow ?? m.estValueHigh, m.estValueCurrency || "SEK")}${m.estValueLow != null && m.estValueHigh != null ? "–" + formatMoney(m.estValueHigh, m.estValueCurrency || "SEK") : ""}`
    : "";
  const dealCount = m.listings?.length || 0;
  const img = displayImg(m);
  return (
    <div className="card mug" data-flip-key={m.id} data-mug-id={m.id} role="button" tabIndex={0} onClick={() => onEdit(m)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(m); } }}>
      <div className="mugphoto">
        {img ? <img src={img} alt={displayName} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span className="ph"><MugMark size={46} /></span>}
        <button type="button" className={"favfab" + (m.favorite ? " on" : "")} aria-label={t("card_fav")} title={t("card_fav")} onClick={(e) => { e.stopPropagation(); onFav(m); }}><Star size={17} fill={m.favorite ? "currentColor" : "none"} /></button>
      </div>
      <div className="mugbody">
        <div className="mugname" title={displayName}>{displayName || t("card_untitled")}</div>
        <div className="sub">{[m.series || "—", m.year, m.edition].filter(Boolean).join(" · ")}</div>
        <div className="badges">
          {m.condition ? <Badge><CheckCircle2 size={12} /> {condLabel(t, m.condition)}</Badge> : null}
          {m.hasTag ? <Badge kind="fav"><Tag size={12} /> {t("form_has_tag")}</Badge> : null}
          {m.price !== "" && m.price != null ? <Badge><Coins size={12} /> {formatMoney(m.price, m.currency || "SEK")}</Badge> : null}
          {val ? <Badge title={t("card_est_title")}>≈ {val}</Badge> : null}
          {m.location ? <Badge><MapPin size={12} /> {m.location}</Badge> : null}
          {m.status === "wishlist" && dealCount ? <Badge kind="deal"><Bell size={12} /> {t("card_found", { n: dealCount })}</Badge> : null}
        </div>
        {m.tags?.length ? <div className="badges">{m.tags.slice(0, 6).map((t) => <span key={t} className="chip"><Tag size={11} />{t}</span>)}</div> : null}
        {m.conditionNotes ? <div className="mini lineclamp">{m.conditionNotes}</div> : null}
        {m.notes ? <div className="mini lineclamp">{m.notes}</div> : null}
        {m.status === "wishlist" ? (
          <div className="mugfoot" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onDeals(m)}><PackageSearch size={15} /> {t("card_deals")}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------- MugRow ------------------------------- */
// Compact one-row layout: image · name/meta · actions. Swipe left to delete.
const SWIPE_TRIGGER = 72;
// `deleteDir` is the direction that deletes on this tab: "right" on Collection
// (where dragging right is Embla's no-op over-scroll) and "left" on Wishlist.
// The opposite direction is left entirely to Embla for switching tabs.
function MugRow({ m, onEdit, onFav, onDeals, onSwipeDelete, deleteDir }) {
  const t = useT();
  const lang = useLang();
  const displayName = catName(m.name, lang);
  const val = (m.estValueLow != null || m.estValueHigh != null)
    ? `${formatMoney(m.estValueLow ?? m.estValueHigh, m.estValueCurrency || "SEK")}${m.estValueLow != null && m.estValueHigh != null ? "–" + formatMoney(m.estValueHigh, m.estValueCurrency || "SEK") : ""}`
    : "";
  const meta = [m.year, val ? "≈ " + val : null].filter(Boolean).join(" · ");
  const img = displayImg(m);
  const wrapRef = useRef(null);
  const rowRef = useRef(null);
  const dragRef = useRef({ x: 0, y: 0, dx: 0, mode: null });
  const suppressClick = useRef(false);
  const mugRef = useRef(m); mugRef.current = m;
  const deleteRef = useRef(onSwipeDelete); deleteRef.current = onSwipeDelete;
  const dirRef = useRef(deleteDir); dirRef.current = deleteDir;

  // Native listeners so we run before Embla's (React's are delegated too high);
  // a `stopPropagation` on the delete direction keeps Embla from over-scrolling.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onStart = (e) => { const tc = e.touches[0]; dragRef.current = { x: tc.clientX, y: tc.clientY, dx: 0, mode: null }; };
    const onMove = (e) => {
      const d = dragRef.current;
      const tc = e.touches[0];
      const dx = tc.clientX - d.x, dy = tc.clientY - d.y;
      if (!d.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy)) { d.mode = "y"; return; }
        const wantDelete = dirRef.current === "right" ? dx > 0 : dx < 0;
        d.mode = wantDelete ? "delete" : "tab";
      }
      if (d.mode !== "delete") return;
      e.stopPropagation();
      d.dx = dx;
      const el = rowRef.current;
      if (el) {
        const clamped = dirRef.current === "right" ? Math.min(dx, 120) : Math.max(dx, -120);
        el.style.transition = "none";
        el.style.transform = `translateX(${clamped}px)`;
      }
    };
    const onEnd = () => {
      const d = dragRef.current;
      const el = rowRef.current;
      if (el) { el.style.transition = ""; el.style.transform = ""; }
      if (d.mode === "delete") {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 400);
        if (Math.abs(d.dx) >= SWIPE_TRIGGER) deleteRef.current?.(mugRef.current);
      }
      d.mode = null; d.dx = 0;
    };
    wrap.addEventListener("touchstart", onStart, { passive: true });
    wrap.addEventListener("touchmove", onMove, { passive: false });
    wrap.addEventListener("touchend", onEnd);
    wrap.addEventListener("touchcancel", onEnd);
    return () => {
      wrap.removeEventListener("touchstart", onStart);
      wrap.removeEventListener("touchmove", onMove);
      wrap.removeEventListener("touchend", onEnd);
      wrap.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const open = () => { if (suppressClick.current) return; onEdit(m); };

  return (
    <div className="mugrow-swipe" ref={wrapRef} data-flip-key={m.id}>
      <div className={"mugrow-delete " + (deleteDir === "right" ? "left" : "right")} aria-hidden="true"><Trash2 size={18} /><span>{t("card_delete")}</span></div>
      <div className="mugrow" ref={rowRef} data-mug-id={m.id} role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
        <div className="mugrow-thumb">
          {img ? <img src={img} alt={displayName} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <MugMark size={24} />}
        </div>
        <div className="mugrow-main">
          <div className="mugrow-name" title={displayName}>{displayName || t("card_untitled")}</div>
          {meta ? <div className="mini">{meta}</div> : null}
        </div>
        <div className="mugrow-actions" onClick={(e) => e.stopPropagation()}>
          {m.status === "wishlist"
            ? <button className="ghost icon" title={t("card_deals")} aria-label={t("card_deals")} onClick={() => onDeals(m)}><PackageSearch size={17} /></button>
            : <button className={"ghost icon" + (m.favorite ? " fav-on" : "")} title={t("card_fav")} aria-label={t("card_fav")} onClick={() => onFav(m)}><Star size={17} fill={m.favorite ? "currentColor" : "none"} /></button>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ MugList ------------------------------- */
// Renders the mug cards/rows and animates them (FLIP) whenever the set or order
// changes — so filtering, sorting, adding and favouriting glide into place.
function MugList({ items, viewMode, onEdit, onFav, onDeals, onSwipeDelete, deleteDir }) {
  const ref = useRef(null);
  const sig = items.map((m) => m.id).join("|");
  useFlip(ref, sig);
  return viewMode === "grid"
    ? <div className="muggrid" ref={ref}>{items.map((m) => <MugCard key={m.id} m={m} onEdit={onEdit} onFav={onFav} onDeals={onDeals} />)}</div>
    : <div className="muglist" ref={ref}>{items.map((m) => <MugRow key={m.id} m={m} onEdit={onEdit} onFav={onFav} onDeals={onDeals} onSwipeDelete={onSwipeDelete} deleteDir={deleteDir} />)}</div>;
}

/* -------------------------------- App --------------------------------- */
export default function App() {
  const [lang, setLang] = useState("sv");
  const [theme, setTheme] = useState("system"); // system | light | dark
  const t = useMemo(() => makeT(lang), [lang]);
  useRipple(); // delegated press ripple for every control

  // Auth is optional: signed-in users own by Google account, everyone else by a
  // per-device id. NEXT_PUBLIC_DEV_OWNER is a local-only bypass for testing.
  const { data: session, status } = useSession();
  const devOwner = process.env.NEXT_PUBLIC_DEV_OWNER || "";
  const signedIn = status === "authenticated" || !!devOwner;
  const currentUser = session?.user || (devOwner ? { email: devOwner, name: devOwner } : null);

  const [mugs, setMugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("collection");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sortBy, setSortBy] = useState("updated_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState("table"); // table | grid
  const [anonNoteHidden, setAnonNoteHidden] = useState(true); // hidden until we know sign-in state

  const [formInitial, setFormInitial] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addAnchorRef = useRef(null);      // element the add menu points at
  const [addPhoto, setAddPhoto] = useState(""); // photo handed to the add dialog
  const camRef = useRef(null), fileRef = useRef(null); // hidden capture/pick inputs
  const [gapOpen, setGapOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
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
    const isSnap = (u) => !u || (typeof u === "string" && u.startsWith("data:"));  // no photo, or a camera snapshot
    const targets = (list || []).filter((m) => m && m.id && m.name && (isSnap(m.photoUrl) || m.year == null || (m.estValueLow == null && m.estValueHigh == null)));
    for (const m of targets) {
      try {
        const { imageUrl, year, value } = await api("/api/mug-image", { method: "POST", body: JSON.stringify({ id: m.id, name: m.name, series: m.series, year: m.year, edition: m.edition }) });
        setMugs((prev) => prev.map((x) => {
          if (x.id !== m.id) return x;
          const n = { ...x };
          if (imageUrl && isSnap(n.photoUrl)) n.photoUrl = imageUrl;
          if (year && n.year == null) n.year = year;
          if (value && n.estValueLow == null && n.estValueHigh == null) { n.estValueLow = value.low; n.estValueHigh = value.high; n.estValueCurrency = value.cur; }
          return n;
        }));
      } catch { /* ignore — the card keeps its placeholder */ }
    }
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "wishlist") setTab("wishlist");
    // Restore the saved language preference (Swedish by default).
    try { const saved = localStorage.getItem("lang"); if (saved === "sv" || saved === "en") setLang(saved); } catch { /* ignore */ }
    // Restore the saved theme preference (follows the system by default).
    try { const th = localStorage.getItem("theme"); if (th === "light" || th === "dark") setTheme(th); } catch { /* ignore */ }
    // Restore the saved list view mode (compact table by default).
    try { const vm = localStorage.getItem("viewMode"); if (vm === "grid" || vm === "table") setViewMode(vm); } catch { /* ignore */ }
    // Show the "not signed in" note unless it was dismissed before.
    try { setAnonNoteHidden(localStorage.getItem("anonNoteDismissed") === "1"); } catch { setAnonNoteHidden(false); }
    // Register the service worker so the app is an installable PWA.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    load();
  }, []);
  // On sign-in, migrate this device's anonymous collection to the account, then resync.
  const claimedRef = useRef(false);
  useEffect(() => {
    if (status !== "authenticated" || claimedRef.current) return;
    claimedRef.current = true;
    (async () => { try { const { moved } = await api("/api/claim", { method: "POST" }); await reload(); if (moved) setTab("collection"); } catch { reload(); } })();
  }, [status]);
  useEffect(() => {
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => { try { localStorage.setItem("viewMode", viewMode); } catch { /* ignore */ } }, [viewMode]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { if (theme === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);
  // Reflect an existing push subscription so we don't nudge users who already enabled it.
  useEffect(() => {
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") setNotifState("on");
      } catch { /* ignore */ }
    })();
  }, []);

  const saveMug = async (next, opts = {}) => {
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
      if (!opts.keepOpen) setFormOpen(false);
      return true;
    } catch (e) { toast.error(t("save_failed", { msg: e.message || e })); return false; }
    finally { setSaving(false); }
  };
  const addMany = async (drafts) => {
    try {
      const created = [];
      for (const d of drafts) { const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(d) }); created.push(mug); }
      setMugs((prev) => [...created, ...prev]);
      ensureImages(created);
    } catch (e) { toast.error(t("add_failed", { msg: e.message || e })); }
  };
  // Create a mug; returns it (or null on failure).
  const quickAdd = async (draft) => {
    try {
      const { mug } = await api("/api/mugs", { method: "POST", body: JSON.stringify(draft) });
      setMugs((prev) => [mug, ...prev]);
      if (!mug.photoUrl) ensureImages([mug]);
      return mug;
    } catch (e) { toast.error(t("add_failed", { msg: e.message || e })); return null; }
  };
  // Adding a mug always goes through a confirmation dialog (price/condition/tag).
  const addResolveRef = useRef(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const requestAdd = (draft) => new Promise((resolve) => { addResolveRef.current = resolve; setPendingAdd({ ...draft }); });
  const finishAdd = (created) => { const r = addResolveRef.current; addResolveRef.current = null; setPendingAdd(null); r?.(created || null); };
  const confirmAdd = async (patch, more) => {
    const d = pendingAdd; if (!d) return;
    setSaving(true);
    try {
      const mug = await quickAdd({ ...d, ...patch });
      finishAdd(mug);
      // "Save" finishes the add flow; "save and add more" leaves it open.
      if (!more) setScanOpen(false);
    } finally { setSaving(false); }
  };
  // Delete with a short undo window: the row leaves immediately and the server
  // call is deferred, so Undo can cancel it. Every delete gets its own toast, and
  // Sonner stacks them, so several quick deletes are all recoverable.
  const pendingDeletes = useRef(new Map());
  // Put a restored mug back where it was: after the neighbour it sat below before
  // deletion (falls back to the top when it was the first row).
  const restoreMug = (m, afterId) => setMugs((prev) => {
    if (prev.some((x) => x.id === m.id)) return prev;
    if (afterId) {
      const i = prev.findIndex((x) => x.id === afterId);
      if (i >= 0) { const next = prev.slice(); next.splice(i + 1, 0, m); return next; }
    }
    return [m, ...prev];
  });
  const softDelete = (m) => {
    const node = typeof document !== "undefined" ? document.querySelector(`[data-mug-id="${String(m.id).replace(/["\\]/g, "\\$&")}"]`) : null;
    const rect = node?.getBoundingClientRect();
    if (node && rect) animateGhost(node, rect);
    // Remember the row above so Undo can drop it back into place.
    const wrap = node?.parentElement;
    const afterId = wrap?.previousElementSibling?.querySelector?.("[data-mug-id]")?.getAttribute("data-mug-id") || null;
    setMugs((prev) => prev.filter((x) => x.id !== m.id));
    const timer = window.setTimeout(async () => {
      pendingDeletes.current.delete(m.id);
      try { await api(`/api/mugs/${m.id}`, { method: "DELETE" }); }
      catch (e) { restoreMug(m, afterId); toast.error(t("delete_failed", { msg: e.message || e })); }
    }, UNDO_MS);
    pendingDeletes.current.set(m.id, { timer, afterId });
    const tid = toast(t("deleted_toast", { name: catName(m.name, lang) }), {
      duration: UNDO_MS,
      classNames: { toast: "toast-long" },
      action: {
        label: t("undo"),
        onClick: () => {
          const entry = pendingDeletes.current.get(m.id);
          if (entry) { window.clearTimeout(entry.timer); pendingDeletes.current.delete(m.id); }
          toast.dismiss(tid);
          restoreMug(m, entry?.afterId);
        },
      },
    });
  };
  // If the tab is closed during the undo window, commit pending deletes so a mug
  // can't silently come back later.
  useEffect(() => {
    const flush = () => {
      pendingDeletes.current.forEach((entry, id) => {
        window.clearTimeout(entry.timer);
        try { fetch(`/api/mugs/${id}`, { method: "DELETE", headers: { "x-device-id": getDeviceId() }, keepalive: true }); } catch { /* ignore */ }
      });
      pendingDeletes.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
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

  const openEdit = (m) => { setFormInitial({ ...m }); setFormOpen(true); };

  // The add menu springs from whichever trigger was tapped (FAB or header Add).
  const openAddMenu = (el) => { addAnchorRef.current = el; warmUp(); setAddMenuOpen(true); };
  const startAddBrowse = () => { setAddPhoto(""); setScanOpen(true); };
  const startAddPhoto = (dataUrl) => { setAddPhoto(dataUrl); setScanOpen(true); };
  const pickPhoto = async (file) => {
    if (!file) return;
    const raw = await fileToDataUrl(file);
    startAddPhoto(await downscaleImage(raw, 1400, 0.85));
  };

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
  // Fire a one-off push to this owner's devices to confirm the pipeline works.
  const testNotif = async () => {
    try {
      const { sent } = await api("/api/push/test", { method: "POST" });
      if (sent > 0) toast.success(t("notif_test_sent"));
      else toast.error(t("notif_test_none"));
    } catch (e) { toast.error(t("notif_test_failed", { msg: e.message || e })); }
  };

  const mugSearch = useMemo(() => createSearch(mugs, {
    name: (m) => m.name,
    sv: (m) => catName(m.name, "sv"),
    series: (m) => m.series,
    edition: (m) => m.edition,
    condition: (m) => m.condition,
    conditionNotes: (m) => m.conditionNotes,
    location: (m) => m.location,
    notes: (m) => m.notes,
    tags: (m) => (m.tags || []).join(" "),
    year: (m) => m.year,
  }), [mugs]);

  const panels = useMemo(() => {
    const build = (k) => {
      let out = mugs.filter((m) => {
        if (k === "wishlist") { if (m.status !== "wishlist") return false; }
        else {
          // The collection tab is owned/sold only — wishlist has its own tab.
          if (m.status === "wishlist") return false;
          if (statusFilter !== "all" && m.status !== statusFilter) return false;
        }
        if (favoriteOnly && !m.favorite) return false;
        return true;
      });
      if (query.trim()) {
        const rank = new Map(mugSearch(query).map((m, i) => [m.id, i]));
        out = out.filter((m) => rank.has(m.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
      } else {
        out.sort((a, b) => {
          const au = a.updatedAt ? Date.parse(a.updatedAt) : 0, bu = b.updatedAt ? Date.parse(b.updatedAt) : 0;
          if (sortBy === "updated_desc") return bu - au;
          if (sortBy === "year_desc") return (Number(b.year) || 0) - (Number(a.year) || 0);
          if (sortBy === "year_asc") return (Number(a.year) || 0) - (Number(b.year) || 0);
          if (sortBy === "value_desc") return (Number(b.estValueHigh ?? b.estValueLow) || 0) - (Number(a.estValueHigh ?? a.estValueLow) || 0);
          return normalizeText(a.name).localeCompare(normalizeText(b.name));
        });
      }
      return out;
    };
    return { collection: build("collection"), wishlist: build("wishlist") };
  }, [mugs, query, statusFilter, favoriteOnly, sortBy, mugSearch]);

  // Owned/sold mugs (the collection); wishlist has its own tab.
  const collectionCount = useMemo(() => mugs.filter((m) => m.status !== "wishlist").length, [mugs]);

  // Swipeable tabs via Embla: dragging the panel moves between collection and
  // wishlist, and the active tab follows the snap point.
  const TAB_ORDER = ["collection", "wishlist"];
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", containScroll: false, duration: 22, skipSnaps: false });
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setTab(TAB_ORDER[emblaApi.selectedScrollSnap()] || "collection");
    emblaApi.on("select", onSelect);
    return () => { emblaApi.off("select", onSelect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblaApi]);
  useEffect(() => { if (emblaApi) emblaApi.scrollTo(Math.max(0, TAB_ORDER.indexOf(tab))); }, [tab, emblaApi]);

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
    { k: "collection", label: `${t("tab_collection")}${collectionCount ? ` (${collectionCount})` : ""}` },
    { k: "wishlist", label: `${t("tab_wishlist")}${stats.wishlist ? ` (${stats.wishlist})` : ""}` },
  ];

  // One shared search + filter bar for the list tabs (Collection / Wishlist).
  const showSearchBar = tab === "collection" ? collectionCount > 0 : tab === "wishlist" ? stats.wishlist > 0 : false;

  return (
    <I18nContext.Provider value={t}>
    <LangContext.Provider value={lang}>
    <div className="wrap">
      <header className="top">
        <div className="topbar">
          <div className="brand" role="button" tabIndex={0} onClick={() => setTab("collection")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setTab("collection"); }} aria-label={t("nav_collection")}>
            <div className="title"><h1>{t("app_title")}</h1><span className="ver">v{APP_VERSION}</span></div>
          </div>
          <div className="actions">
            <button className="primary hide-mobile" onClick={(e) => openAddMenu(e.currentTarget)}><Plus size={16} /> {t("nav_add")}</button>
            <button className="hide-mobile" onClick={() => setGapOpen(true)}><Sparkles size={16} /> {t("gaps_btn")}</button>
            <button className="ghost icon" title={t("tab_stats")} aria-label={t("tab_stats")} onClick={() => setStatsOpen(true)}><BarChart3 size={18} /></button>
            <button className="ghost icon" title={t("notif_about_aria")} aria-label={t("about_title")} onClick={() => setAboutOpen(true)}><Bell size={18} /></button>
            <AccountMenu user={currentUser} signedIn={signedIn} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} onImport={() => setImportOpen(true)} />
          </div>
        </div>
        <svg className="topwave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,22 C180,40 360,4 720,16 C1080,28 1260,40 1440,14 L1440,0 L0,0 Z" /></svg>
      </header>

      {loadError ? <div className="note warn" style={{ marginBottom: 12 }}>{t("load_error", { msg: loadError })}</div> : null}

      {!signedIn && status !== "loading" && !anonNoteHidden ? (
        <div className="anonnote">
          <div className="mini">{t("anon_warning")}</div>
          <div className="anonnote-actions">
            <button className="primary" onClick={() => signIn("google")}>{t("signin_google")}</button>
            <button className="ghost icon" aria-label={t("dismiss")} title={t("dismiss")} onClick={() => { setAnonNoteHidden(true); try { localStorage.setItem("anonNoteDismissed", "1"); } catch { /* ignore */ } }}><X size={16} /></button>
          </div>
        </div>
      ) : null}

      {/* Shared search + filters — one section for both Collection and Wishlist. */}
      {showSearchBar ? (
        <div className="card pad" style={{ marginBottom: 12 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <div className="field searchfield" style={{ flex: 1 }}>
              <Search size={17} className="searchicon" aria-hidden="true" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search_ph")} aria-label={t("search")} />
            </div>
            <div className="viewtoggle" role="group" aria-label={t("view_mode")}>
              <button type="button" className={"ghost icon" + (viewMode === "table" ? " active" : "")} onClick={() => setViewMode("table")} aria-pressed={viewMode === "table"} aria-label={t("view_table")} title={t("view_table")}><Rows3 size={18} /></button>
              <button type="button" className={"ghost icon" + (viewMode === "grid" ? " active" : "")} onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"} aria-label={t("view_grid")} title={t("view_grid")}><LayoutGrid size={18} /></button>
            </div>
            <button type="button" className={"ghost icon" + (filtersOpen ? " active" : "")} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-label={t("filters")} title={t("filters")}><SlidersHorizontal size={18} /></button>
          </div>
          <div className={"collapse" + (filtersOpen ? " open" : "")}>
            <div className="collapse-inner">
              <div className="row" style={{ marginTop: 12 }}>
                {tab === "collection" ? (
                  <div className="field" style={{ minWidth: 150 }}><label>{t("filter_status")}</label><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">{t("filter_all")}</option>{STATUS_VALUES.filter((s) => s !== "wishlist").map((s) => <option key={s} value={s}>{t("status_" + s)}</option>)}</select></div>
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
            </div>
          </div>
        </div>
      ) : null}

      {/* Collection and Wishlist are the top-level tabs; Stats opens from the header. */}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div className="pager" ref={emblaRef}>
        <div className="track">
          {TAB_ORDER.map((k) => (
            <section className="panel" key={k} aria-hidden={tab !== k}>
              <div className="panel-scroll">
                {k === "wishlist" && stats.wishlist > 0 && notifState !== "on" ? (
                  <div className="card pad notifblurb">
                    <div className="nbicon"><Bell size={26} /></div>
                    <div className="nbtext">
                      <div className="t-h3">{t("wishlist_notif_title")}</div>
                      <div className="sub" style={{ marginTop: 4 }}>{t("wishlist_notif_body")}</div>
                      {notifMsg && notifState !== "on" ? <div className="help" style={{ marginTop: 6 }}>{notifMsg}</div> : null}
                    </div>
                    <button className="primary" onClick={enableNotifications} disabled={notifState === "unsupported"}><Bell size={16} /> {notifState === "error" ? t("wishlist_notif_retry") : t("about_enable")}</button>
                  </div>
                ) : null}
                {loading ? (
                  <div className="card pad"><span className="spin" /> {t("loading")}</div>
                ) : k === "wishlist" && panels.wishlist.length === 0 ? (
                  <div className="card pad" style={{ textAlign: "center" }}>
                    <div className="emptyicon"><Heart size={34} /></div>
                    <div className="t-h1" style={{ marginTop: 8 }}>{t("wishlist_empty_title")}</div>
                    <div className="sub" style={{ marginTop: 6 }}>{t("wishlist_empty_sub")}</div>
                    <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
                      <button className="primary" onClick={() => setGapOpen(true)}><BookOpen size={16} /> {t("wishlist_browse")}</button>
                    </div>
                  </div>
                ) : k === "collection" && collectionCount === 0 ? (
                  <div className="card pad empty">
                    <MugShelf />
                    <div className="t-h1" style={{ marginTop: 12 }}>{t("empty_title")}</div>
                    <div className="sub" style={{ marginTop: 6 }}>{t("empty_sub")}</div>
                    <div className="emptyactions">
                      <button className="primary accent big" onClick={() => camRef.current?.click()}><Camera size={18} /> {t("scan_take_photo")}</button>
                      <button className="ghost accent big" onClick={() => fileRef.current?.click()}><ImagePlus size={18} /> {t("scan_choose_image")}</button>
                      <button className="ghost accent big" onClick={startAddBrowse}><Search size={18} /> {t("add_search_catalog")}</button>
                    </div>
                  </div>
                ) : panels[k].length === 0 ? (
                  <div className="card pad"><div className="muted">{t("no_match")}</div></div>
                ) : (
                  <MugList key={viewMode} items={panels[k]} viewMode={viewMode} onEdit={openEdit} onFav={fav} onDeals={setDealsMug} onSwipeDelete={softDelete} deleteDir={k === "collection" ? "right" : "left"} />
                )}
                {k === "wishlist" && panels.wishlist.length ? <div className="row" style={{ justifyContent: "center", marginTop: 14 }}><button onClick={() => setGapOpen(true)}><BookOpen size={16} /> {t("wishlist_browse")}</button></div> : null}
              </div>
            </section>
          ))}
        </div>
      </div>

      <button className={"fab" + (addMenuOpen ? " open" : "")} aria-expanded={addMenuOpen}
        onClick={(e) => { if (addMenuOpen) setAddMenuOpen(false); else openAddMenu(e.currentTarget); }}
        aria-label={t("nav_add_aria")} title={t("nav_add")}><Plus size={28} /></button>

      <footer className="sitefoot hide-mobile">
        <svg className="wave" viewBox="0 0 1440 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0,26 C180,48 360,6 720,20 C1080,34 1260,48 1440,18 L1440,48 L0,48 Z" /></svg>
        <div className="footinner"><span className="footmark"><MugMark size={20} /></span><span>{t("app_title")}</span></div>
      </footer>

      <MugForm open={formOpen} onClose={() => setFormOpen(false)} initial={formInitial} mugs={mugs} onSave={saveMug} saving={saving}
        onDelete={(m) => { setFormOpen(false); softDelete(m); }} />
      <AddMenu open={addMenuOpen} onOpenChange={setAddMenuOpen} anchorRef={addAnchorRef} onBrowse={startAddBrowse}
        onCamera={() => camRef.current?.click()} onFile={() => fileRef.current?.click()} />
      <input className="sr-only" ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      <input className="sr-only" ref={fileRef} type="file" accept="image/*" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      <AddMugModal open={scanOpen} initialPhoto={addPhoto} onClose={() => { setScanOpen(false); setAddPhoto(""); }} mugs={mugs} onAddOne={requestAdd} onAddMany={addMany} onAddRequest={requestAdd} onQuickAdd={quickAdd} />
      <AddConfirmModal draft={pendingAdd} onCancel={() => finishAdd(null)} onConfirm={confirmAdd} saving={saving} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />
      <GapFinder open={gapOpen} onClose={() => setGapOpen(false)} mugs={mugs} onAddWishlist={(d) => { addMany(d); setTab("wishlist"); }} />
      <DealsModal open={!!dealsMug} onClose={() => setDealsMug(null)} mug={dealsMug} />
      <Toaster position="top-center" richColors closeButton expand visibleToasts={5} />

      <Modal open={statsOpen} onClose={() => setStatsOpen(false)} title={t("tab_stats")} subtitle={t("stats_subtitle")} wide>
        <div className="grid" style={{ gap: 12 }}>
          <div className="kpi">
            <div className="card kpicard"><div className="kpilabel">{t("kpi_owned")}</div><div className="kpivalue"><CountUp value={stats.owned} /></div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_wishlist")}</div><div className="kpivalue"><CountUp value={stats.wishlist} /></div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_favorites")}</div><div className="kpivalue"><CountUp value={stats.favorites} /></div></div>
            <div className="card kpicard"><div className="kpilabel">{t("kpi_sold")}</div><div className="kpivalue"><CountUp value={stats.sold} /></div></div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div className="kpilabel">{t("stats_total_paid")}</div><div className="t-h1" style={{ fontWeight: 300, marginTop: 6 }}><CountUp value={stats.spent} format={(n) => formatMoney(n, "SEK")} /></div></div>
            <div className="card pad" style={{ flex: 1, minWidth: 200 }}><div className="kpilabel">{t("stats_est_value")}</div><div className="t-h1" style={{ fontWeight: 300, marginTop: 6 }}><CountUp value={stats.value} format={(n) => formatMoney(n, stats.valueCur)} /></div><div className="help" style={{ marginTop: 4 }}>{t("stats_est_value_sub")}</div></div>
          </div>
          <div className="card pad">
            <div style={{ fontWeight: 500 }}>{t("stats_by_year")}</div><div className="divider" />
            {stats.byYearData.length ? <div className="list">{stats.byYearData.map((r, i) => (
              <div key={r.year} className="listrow"><div style={{ fontWeight: 700, width: 52 }}>{r.year}</div><div className="bar"><span style={{ width: `${(r.count / stats.maxYear) * 100}%`, animationDelay: `${i * 45}ms` }} /></div><span className="pill">{r.count}</span></div>
            ))}</div> : <div className="muted">{t("stats_by_year_empty")}</div>}
          </div>
          <div className="card pad">
            <div style={{ fontWeight: 500 }}>{t("stats_top_chars")}</div><div className="divider" />
            {stats.topChars.length ? <div className="list">{stats.topChars.map((tc) => <div key={tc.name} className="listrow"><div>{tc.name}</div><span className="pill">{tc.count}</span></div>)}</div> : <div className="muted">{t("stats_top_chars_empty")}</div>}
          </div>
        </div>
      </Modal>

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={t("about_title")} subtitle={t("about_subtitle")}>
        <div className="grid" style={{ gap: 12 }}>
          <div className="note">{t("about_body")}</div>
          <button className="primary" onClick={enableNotifications} disabled={notifState === "on"}>{notifState === "on" ? <CheckCircle2 size={16} /> : <Bell size={16} />} {notifState === "on" ? t("about_enabled") : t("about_enable")}</button>
          {notifState === "on" ? <button onClick={testNotif}><Bell size={16} /> {t("notif_test")}</button> : null}
          {notifMsg ? <div className={"note " + (notifState === "on" ? "good" : "warn")}>{notifMsg}</div> : null}
          <div className="help">{t("about_help")}</div>
          <div className="divider" />
          <div className="note">{t("catalog_about")}</div>
          <button onClick={fillCatalog} disabled={catalogBusy}>{catalogBusy ? <><span className="spin" /> {t("catalog_filling")}</> : <><BookOpen size={16} /> {t("catalog_fill")}</>}</button>
          {catalogMsg ? <div className="note good">{catalogMsg}</div> : null}
        </div>
      </Modal>
    </div>
    </LangContext.Provider>
    </I18nContext.Provider>
  );
}
