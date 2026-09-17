"use client";
import { useEffect, useState } from "react";
import {
  Search, SlidersHorizontal, Rows3, LayoutGrid, Star, Trash2, Heart, Plus, X,
  Camera, ImagePlus, Coins, PackageSearch,
} from "lucide-react";
import css from "./type.module.css";

/* ------------------------------------------------------------------ */
/* A playground for the type + icon scales. Tune the scale steps, the  */
/* icon sizes and/or pick a class per atom; then "Copy spec".          */
/* ------------------------------------------------------------------ */

const SCALE = [
  { cls: "t-h1", name: "h1", v: "--fs-h1" },
  { cls: "t-h2", name: "h2", v: "--fs-h2" },
  { cls: "t-h3", name: "h3", v: "--fs-h3" },
  { cls: "t-body", name: "body", v: "--fs-body" },
  { cls: "t-ui", name: "ui", v: "--fs-ui" },
  { cls: "t-label", name: "label", v: "--fs-label" },
  { cls: "t-secondary", name: "secondary", v: "--fs-secondary" },
  { cls: "t-caption", name: "caption", v: "--fs-caption" },
  { cls: "t-tiny", name: "tiny", v: "--fs-tiny" },
];
const VAR_OF = Object.fromEntries(SCALE.map((s) => [s.cls, s.v]));
const STORAGE_KEY = "muminmuggar-type-tool-v3";
const DEFAULT_SCALE = { "t-h1": 1.75, "t-h2": 1.25, "t-h3": 1.125, "t-body": 1, "t-ui": 0.9375, "t-label": 0.875, "t-secondary": 0.8125, "t-caption": 0.75, "t-tiny": 0.6875 };

const ICONS = [
  { id: "xs", label: "Badge", def: 12 },
  { id: "sm", label: "Button", def: 16 },
  { id: "md", label: "Row / header", def: 18 },
  { id: "lg", label: "Add / menu", def: 22 },
  { id: "xl", label: "Large (FAB)", def: 28 },
];
const DEFAULT_ICONS = Object.fromEntries(ICONS.map((i) => [i.id, i.def]));

const Mug = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 17h20v13a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z" />
    <path d="M33 20h3.5a4.5 4.5 0 0 1 0 9H33" />
  </svg>
);
const MugShelf = () => (
  <svg className="emptyart" viewBox="0 0 160 100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 88h144" /><path d="M16 88v6M144 88v6" opacity=".45" />
    <path d="M20 58h24v24a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5z" /><path d="M44 64h5a6 6 0 0 1 0 12h-5" />
    <path d="M66 44h26v38a5 5 0 0 1-5 5H71a5 5 0 0 1-5-5z" /><path d="M92 54h6a6 6 0 0 1 0 12h-6" />
    <path d="M75 34c0 3-3 3-3 6M84 34c0 3-3 3-3 6" opacity=".5" />
    <path d="M112 60h24v22a5 5 0 0 1-5 5h-14a5 5 0 0 1-5-5z" /><path d="M136 66h5a6 6 0 0 1 0 12h-5" />
  </svg>
);

const MODAL_RESET = { position: "static", left: "auto", top: "auto", transform: "none", width: "100%", maxWidth: 720, maxHeight: "none", overflow: "visible", margin: 0, boxShadow: "none" };

/* -------------------------------- atoms ------------------------------- */
const ATOMS = [
  { id: "header-title", label: "Header title", css: ".title h1", def: "t-h1",
    render: ({ style }) => <h1 style={style}>Muminmuggar</h1> },
  { id: "header-version", label: "Header version", css: ".ver", def: "t-tiny",
    render: ({ style }) => <span className="ver" style={style}>v1.59.0</span> },
  { id: "tab", label: "Tab label", css: ".tabbtn", def: "t-ui",
    render: ({ style }) => <button className="tabbtn active" style={style}>Samlingen</button> },
  { id: "input", label: "Text field", css: "input / select", def: "t-ui",
    render: ({ style }) => <input style={style} placeholder="Sök mugg…" readOnly /> },
  { id: "field-label", label: "Field label", css: "label", def: "t-secondary",
    render: ({ style }) => <label style={style}>Skick</label> },
  { id: "btn-primary", label: "Button — primary", css: ".primary", def: "t-label",
    render: ({ style }) => <button className="primary" style={style}>Lägg till</button> },
  { id: "btn-secondary", label: "Button — secondary", css: "button", def: "t-label",
    render: ({ style }) => <button style={style}>Stäng</button> },
  { id: "btn-link", label: "Button — link", css: ".linkbtn", def: "t-ui",
    render: ({ style }) => <button className="linkbtn" style={style}>Avbryt</button> },
  { id: "badge", label: "Badge", css: ".badge", def: "t-caption",
    render: ({ style, icon }) => <span className="badge owned" style={style}><Coins size={icon("xs")} /> Äger</span> },
  { id: "chip", label: "Chip", css: ".chip", def: "t-caption",
    render: ({ style }) => <span className="chip" style={style}>limiterad</span> },
  { id: "mugrow-name", label: "List row — name", css: ".mugrow-name", def: "t-h3",
    render: ({ style, icon }) => (
      <div className="mugrow" style={{ width: "100%" }}>
        <div className="mugrow-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}><Mug size={icon("lg")} /></div>
        <div className="mugrow-main"><div className="mugrow-name" style={style}>Moomintroll</div><div className="mini">1990 · ≈ 250 kr</div></div>
      </div>
    ) },
  { id: "mugrow-meta", label: "List row — meta", css: ".mini", def: "t-secondary",
    render: ({ style }) => <div className="mini" style={style}>1990 · ≈ 250 kr</div> },
  { id: "mugcard-name", label: "Grid card — name", css: ".mugname", def: "t-body",
    render: ({ style }) => <div className="mugname" style={style}>Moomintroll</div> },
  { id: "mugcard-sub", label: "Grid card — sub", css: ".mugbody .sub", def: "t-secondary",
    render: ({ style }) => <div className="sub" style={style}>Arabia Moomin · 1990</div> },
  { id: "addmenu", label: "Add menu — item", css: ".addmenu-item", def: "t-h3",
    render: ({ style, icon }) => <button className="addmenu-item" style={{ ...style, animation: "none" }}><Camera size={icon("lg")} /><span>Ta foto</span></button> },
  { id: "dialog-title", label: "Dialog title", css: ".modal h2", def: "t-h2",
    render: ({ style }) => <h2 style={style}>Lägg till mugg</h2> },
  { id: "help", label: "Help / hint text", css: ".help", def: "t-secondary",
    render: ({ style }) => <div className="help" style={style}>Sök i katalogen och lägg till med ett tryck.</div> },
  { id: "kpi-label", label: "Stat — label", css: ".kpilabel", def: "t-secondary",
    render: ({ style }) => <div className="kpilabel" style={style}>Ägda</div> },
  { id: "kpi-value", label: "Stat — value", css: ".kpivalue", def: "t-h1",
    render: ({ style }) => <div className="kpivalue" style={style}>42</div> },
  { id: "deal-title", label: "Deal row — title", css: ".dealrow-title", def: "t-body",
    render: ({ style }) => <div className="dealrow-title" style={style}>Muminmugg Moomintroll 1990</div> },
  { id: "deal-price", label: "Deal row — price", css: ".dealrow-price-main", def: "t-h2",
    render: ({ style }) => <span className="dealrow-price-main" style={style}>Bud 250 kr</span> },
  { id: "empty-title", label: "Empty state — title", css: ".t-h2", def: "t-h2",
    render: ({ style }) => <div className="t-h2" style={style}>Börja din samling</div> },
  { id: "empty-sub", label: "Empty state — sub", css: ".sub", def: "t-secondary",
    render: ({ style }) => <div className="sub" style={style}>Fotografera flera muggar samtidigt — en hel hylla går bra.</div> },
  { id: "pick-name", label: "Picker — name", css: ".pickname", def: "t-ui",
    render: ({ style }) => <span className="pickname" style={style}>Moomintroll</span> },
  { id: "pick-meta", label: "Picker — meta", css: ".pickmeta", def: "t-caption",
    render: ({ style }) => <span className="pickmeta" style={style}>1990 · 0,4 L</span> },
];

/* ------------------------------ components ---------------------------- */
const COMPONENTS = [
  { id: "list-view", label: "List view", css: ".muglist / .mugrow",
    render: ({ s, icon }) => (
      <div className="muglist" style={{ width: "100%" }}>
        {[["Moomintroll", "1990 · ≈ 250 kr"], ["Snorkmaiden", "2001 · ≈ 180 kr"], ["Muminpappan", "2010 · ≈ 320 kr"]].map(([name, meta]) => (
          <div className="mugrow" key={name}>
            <div className="mugrow-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}><Mug size={icon("lg")} /></div>
            <div className="mugrow-main">
              <div className="mugrow-name" style={s("mugrow-name")}>{name}</div>
              <div className="mini" style={s("mugrow-meta")}>{meta}</div>
            </div>
            <div className="mugrow-actions">
              <button className="ghost icon" aria-label="Favorit"><Star size={icon("md")} /></button>
              <button className="ghost icon danger" aria-label="Ta bort"><Trash2 size={icon("md")} /></button>
            </div>
          </div>
        ))}
      </div>
    ) },
  { id: "grid-view", label: "Grid view", css: ".muggrid / .mug",
    render: ({ s, icon }) => (
      <div className="muggrid" style={{ width: "100%", gridTemplateColumns: "1fr 1fr" }}>
        {[["Moomintroll", "Arabia Moomin · 1990", true], ["Snorkmaiden", "Arabia Moomin · 2001", false]].map(([name, sub, fav]) => (
          <div className="card mug" key={name}>
            <div className="mugphoto">
              <span className="ph" style={{ color: "var(--accent)", opacity: .55 }}><Mug size={icon("xl")} /></span>
              <button className={"favfab" + (fav ? " on" : "")} aria-label="Favorit"><Star size={icon("sm")} fill={fav ? "currentColor" : "none"} /></button>
            </div>
            <div className="mugbody">
              <div className="mugname" style={s("mugcard-name")}>{name}</div>
              <div className="sub" style={s("mugcard-sub")}>{sub}</div>
              <div className="badges">
                <span className="badge owned" style={s("badge")}>Äger</span>
                <span className="badge" style={s("badge")}><Coins size={icon("xs")} /> 250 kr</span>
              </div>
              <div className="mugfoot"><button className="danger" style={s("btn-secondary")}><Trash2 size={icon("sm")} /> Ta bort</button></div>
            </div>
          </div>
        ))}
      </div>
    ) },
  { id: "search-filters", label: "Search + filters", css: ".searchfield / .tabs / .switch",
    render: ({ s, icon }) => (
      <div className="card pad" style={{ width: "100%" }}>
        <div className="row" style={{ alignItems: "center" }}>
          <div className="field searchfield" style={{ flex: 1 }}>
            <Search size={icon("md")} className="searchicon" />
            <input style={s("input")} placeholder="Sök mugg…" readOnly />
          </div>
          <div className="viewtoggle">
            <button className="ghost icon active"><Rows3 size={icon("md")} /></button>
            <button className="ghost icon"><LayoutGrid size={icon("md")} /></button>
          </div>
          <button className="ghost icon active"><SlidersHorizontal size={icon("md")} /></button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field" style={{ minWidth: 150 }}><label style={s("field-label")}>Status</label><select style={s("input")}><option>Alla</option></select></div>
          <div className="field" style={{ minWidth: 170 }}><label style={s("field-label")}>Sortering</label><select style={s("input")}><option>Senast ändrad</option></select></div>
          <div className="field" style={{ maxWidth: 150 }}><label style={s("field-label")}>Favoriter</label><div className="switch"><span className="mini" style={s("help")}>endast</span><input type="checkbox" style={{ width: "auto" }} /></div></div>
        </div>
      </div>
    ) },
  { id: "add-dialog", label: "Add dialog", css: ".modal (browse)",
    render: ({ s, icon }) => (
      <div className="modal" style={MODAL_RESET}>
        <div className="head">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div><h2 style={s("dialog-title")}>Lägg till mugg</h2><div className="help" style={s("help")}>Sök i katalogen och lägg till med ett tryck.</div></div>
            <button className="ghost icon" aria-label="Stäng"><X size={icon("md")} /></button>
          </div>
        </div>
        <div className="body">
          <div className="grid" style={{ gap: 12 }}>
            <div className="field searchfield"><Search size={icon("md")} className="searchicon" /><input style={s("input")} placeholder="Sök mugg…" readOnly /></div>
            {[["Moomintroll", "1990 · 0,4 L"], ["Snorkmaiden", "2001 · 0,3 L"]].map(([name, meta]) => (
              <div className="scanrow" key={name} style={{ alignItems: "center" }}>
                <div className="scanthumb" style={{ color: "var(--accent)" }}><Mug size={icon("lg")} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mugname t-label" style={s("pick-name")}>{name}</div>
                  <div className="mini" style={s("pick-meta")}>{meta}</div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <button className="addbtn" aria-label="Lägg i samlingen"><Plus size={icon("lg")} /></button>
                  <button className="addbtn wish" aria-label="Önska"><Heart size={icon("lg")} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="foot"><button className="big" style={s("btn-secondary")}>Stäng</button></div>
      </div>
    ) },
  { id: "edit-dialog", label: "Edit dialog", css: ".modal (edit)",
    render: ({ s, icon }) => (
      <div className="modal" style={MODAL_RESET}>
        <div className="head"><h2 style={s("dialog-title")}>Redigera mugg</h2></div>
        <div className="body">
          <div className="grid" style={{ gap: 14 }}>
            <div className="editident">
              <div className="editident-photo" style={{ color: "var(--accent)" }}><Mug size={56} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="t-h2 editident-name" style={s("dialog-title")}>Moomintroll</div>
                <div className="sub" style={s("mugcard-sub")}>Arabia Moomin · 1990</div>
              </div>
            </div>
            <div className="row">
              <div className="field"><label style={s("field-label")}>Skick</label><select style={s("input")}><option>Bra</option></select></div>
              <div className="field"><label style={s("field-label")}>Förvärvsdatum</label><input type="date" style={s("input")} defaultValue="2024-05-01" /></div>
            </div>
            <div className="switch"><span className="mini" style={s("help")}>Etikett kvar</span><input type="checkbox" style={{ width: "auto" }} /></div>
            <div className="row">
              <div className="field"><label style={s("field-label")}>Betalt</label><input style={s("input")} defaultValue="249" /></div>
              <div className="field"><label style={s("field-label")}>Valuta</label><select style={s("input")}><option>SEK</option></select></div>
            </div>
            <div className="switch"><span className="mini" style={s("help")}>Markera som favorit</span><input type="checkbox" style={{ width: "auto" }} /></div>
            <div className="field"><label style={s("field-label")}>Anteckningar</label><textarea style={s("input")} defaultValue="Fin mugg, liten nagg." /></div>
          </div>
        </div>
        <div className="foot"><button className="linkbtn" style={s("btn-link")}>Avbryt</button><button className="primary big" style={s("btn-primary")}>Spara</button></div>
      </div>
    ) },
  { id: "add-menu", label: "Add menu (FAB)", css: ".addmenu-item",
    render: ({ s, icon }) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, width: "100%" }}>
        {[["Sök i katalogen", <Search key="s" size={icon("lg")} />], ["Välj foto", <ImagePlus key="i" size={icon("lg")} />], ["Ta foto", <Camera key="c" size={icon("lg")} />]].map(([label, ic]) => (
          <button key={label} className="addmenu-item" style={{ ...s("addmenu"), animation: "none" }}>{ic}<span>{label}</span></button>
        ))}
      </div>
    ) },
  { id: "empty-state", label: "Empty state", css: ".empty",
    render: ({ s, icon }) => (
      <div className="card pad empty" style={{ width: "100%" }}>
        <MugShelf />
        <div className="t-h2" style={{ ...s("empty-title"), marginTop: 12 }}>Börja din samling</div>
        <div className="sub" style={{ ...s("empty-sub"), marginTop: 6 }}>Fotografera flera muggar samtidigt — en hel hylla går bra.</div>
        <div className="emptyactions">
          <button className="primary accent big" style={s("btn-primary")}><Camera size={icon("sm")} /> Ta foto</button>
          <button className="ghost accent big" style={s("btn-secondary")}><ImagePlus size={icon("sm")} /> Välj foto</button>
          <button className="ghost accent big" style={s("btn-secondary")}><Search size={icon("sm")} /> Sök i katalogen</button>
        </div>
      </div>
    ) },
  { id: "deal-row", label: "Deal row", css: ".dealrow",
    render: ({ s, icon }) => (
      <a className="dealrow" style={{ width: "100%" }} onClick={(e) => e.preventDefault()}>
        <div className="dealrow-thumb" style={{ color: "var(--accent)" }}><Mug size={icon("lg")} /></div>
        <div className="dealrow-main">
          <div className="dealrow-title" style={s("deal-title")}>Muminmugg Moomintroll 1990</div>
          <div className="dealrow-price"><span className="dealrow-price-main" style={s("deal-price")}>Bud 250 kr</span><span className="dealrow-price-alt" style={s("help")}>Köp nu 350 kr</span></div>
          <div className="mini dealrow-foot" style={s("mugrow-meta")}>om 2 d · 3 bud</div>
        </div>
      </a>
    ) },
  { id: "stats", label: "Stats dialog", css: ".kpi / .bar",
    render: ({ s }) => (
      <div className="grid" style={{ gap: 12, width: "100%" }}>
        <div className="kpi" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card kpicard"><div className="kpilabel" style={s("kpi-label")}>Ägda</div><div className="kpivalue" style={s("kpi-value")}>42</div></div>
          <div className="card kpicard"><div className="kpilabel" style={s("kpi-label")}>Önskelista</div><div className="kpivalue" style={s("kpi-value")}>7</div></div>
        </div>
        <div className="card pad">
          <div style={{ fontWeight: 500 }}>Per år</div><div className="divider" />
          <div className="list">
            {[["2010", 60], ["2015", 100], ["2020", 35]].map(([year, w]) => (
              <div key={year} className="listrow"><div style={{ fontWeight: 700, width: 52 }}>{year}</div><div className="bar"><span style={{ width: `${w}%`, animation: "none" }} /></div><span className="pill">12</span></div>
            ))}
          </div>
        </div>
      </div>
    ) },
];

const defaults = () => ({
  scale: { ...DEFAULT_SCALE },
  icons: { ...DEFAULT_ICONS },
  vals: Object.fromEntries(ATOMS.map((el) => [el.id, { cls: el.def, rem: 1 }])),
});

export default function TypeTool() {
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [icons, setIcons] = useState(DEFAULT_ICONS);
  const [vals, setVals] = useState(() => defaults().vals);
  const [copied, setCopied] = useState(false);

  // The app shell locks body scrolling; let this page scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.vals) setVals((v) => ({ ...v, ...saved.vals }));
      if (saved?.icons) setIcons((i) => ({ ...i, ...saved.icons }));
    } catch { /* ignore */ }
    const cs = getComputedStyle(document.documentElement);
    const m = {};
    for (const s of SCALE) {
      const n = parseFloat(cs.getPropertyValue(s.v));
      if (Number.isFinite(n) && n > 0) m[s.cls] = n;
    }
    if (Object.keys(m).length) setScale((sc) => ({ ...sc, ...m }));
  }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale, icons, vals })); } catch { /* ignore */ } }, [scale, icons, vals]);

  const update = (id, patch) => setVals((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  const styleFor = (val) => (!val ? {} : val.cls === "custom" ? { fontSize: `${val.rem}rem` } : { fontSize: `var(${VAR_OF[val.cls]})` });
  const scaleStyle = Object.fromEntries(SCALE.map((s) => [s.v, `${scale[s.cls]}rem`]));

  const specText = () => {
    const out = ["Muminmuggar type spec (base 16px)", "", "Scale:"];
    for (const s of SCALE) out.push(`  ${s.name.padEnd(9)} ${scale[s.cls]}rem`);
    out.push("", "Icons:");
    for (const i of ICONS) out.push(`  ${i.label.padEnd(14)} ${icons[i.id]}px`);
    out.push("", "Atoms:");
    for (const el of ATOMS) {
      const v = vals[el.id];
      out.push(`  ${el.id.padEnd(18)} ${(v.cls === "custom" ? `${v.rem}rem (custom)` : v.cls).padEnd(14)} ${el.css}`);
    }
    return out.join("\n");
  };
  const copySpec = async () => {
    const text = specText();
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Copy this:", text); }
  };
  const reset = () => { const d = defaults(); setScale(d.scale); setIcons(d.icons); setVals(d.vals); };
  const toggleTheme = () => {
    const el = document.documentElement;
    const isDark = el.getAttribute("data-theme") === "dark"
      || (!el.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    el.setAttribute("data-theme", isDark ? "light" : "dark");
  };

  const ctxFor = (id) => ({ style: styleFor(vals[id]), s: (x) => styleFor(vals[x]), icon: (x) => icons[x] });

  return (
    <div className={css.wrap}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>Type &amp; icon scale tool</h1>
          <p className={css.sub}>Tune the scales, pick classes per atom — the components below update live. Hit <b>Copy spec</b> and send me the text.</p>
        </div>
        <div className={css.toolbar}>
          <button className="ghost icon" onClick={toggleTheme} title="Toggle light / dark" aria-label="Toggle theme">◐</button>
          <button onClick={reset}>Reset</button>
          <button className="primary" onClick={copySpec}>{copied ? "Copied!" : "Copy spec"}</button>
        </div>
      </header>

      <section className={css.panel}>
        <div className={css.panelTitle}>Type scale (rem)</div>
        <div className={css.panelGrid}>
          {SCALE.map((s) => (
            <label key={s.cls} className={css.row}>
              <span className={css.rowName}>{s.name}</span>
              <input type="range" min="0.5" max="3" step="0.025" value={scale[s.cls]}
                onChange={(e) => setScale((sc) => ({ ...sc, [s.cls]: Number(e.target.value) }))} aria-label={s.name} />
              <b className={css.rowVal}>{scale[s.cls]}rem</b>
            </label>
          ))}
        </div>
      </section>

      <section className={css.panel}>
        <div className={css.panelTitle}>Icon sizes (px)</div>
        <div className={css.panelGrid}>
          {ICONS.map((i) => (
            <label key={i.id} className={css.row}>
              <span className={css.rowName}>{i.label}</span>
              <input type="range" min="8" max="48" step="1" value={icons[i.id]}
                onChange={(e) => setIcons((ic) => ({ ...ic, [i.id]: Number(e.target.value) }))} aria-label={i.label} />
              <b className={css.rowVal}>{icons[i.id]}px</b>
            </label>
          ))}
        </div>
      </section>

      <div style={scaleStyle}>
        <h2 className={css.groupTitle}>Components</h2>
        <div className={css.compList}>
          {COMPONENTS.map((el) => (
            <section key={el.id} className={css.comp}>
              <div className={css.compHead}><span className={css.specLabel}>{el.label}</span><code className={css.specCss}>{el.css}</code></div>
              <div className={css.compPreview}>{el.render(ctxFor(el.id))}</div>
            </section>
          ))}
        </div>

        <h2 className={css.groupTitle}>Atoms</h2>
        <div className={css.grid}>
          {ATOMS.map((el) => {
            const v = vals[el.id];
            return (
              <section key={el.id} className={css.spec}>
                <div className={css.specHead}>
                  <div>
                    <div className={css.specLabel}>{el.label}</div>
                    <code className={css.specCss}>{el.css}</code>
                  </div>
                  <div className={css.specControls}>
                    <select className={css.select} value={v.cls} onChange={(e) => update(el.id, { cls: e.target.value })} aria-label={`${el.label} size`}>
                      {SCALE.map((s) => <option key={s.cls} value={s.cls}>{s.name} · {scale[s.cls]}rem</option>)}
                      <option value="custom">custom…</option>
                    </select>
                    {v.cls === "custom" ? (
                      <span className={css.custom}>
                        <input type="range" min="0.5" max="3" step="0.025" value={v.rem} onChange={(e) => update(el.id, { rem: Number(e.target.value) })} aria-label={`${el.label} custom size`} />
                        <b>{v.rem}rem</b>
                      </span>
                    ) : <span className={css.val}>{scale[v.cls]}rem</span>}
                  </div>
                </div>
                <div className={css.preview}>{el.render(ctxFor(el.id))}</div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
