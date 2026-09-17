"use client";
import { useEffect, useState } from "react";
import css from "./type.module.css";

/* ------------------------------------------------------------------ */
/* A playground for the type scale. Tune the 9 scale steps and/or pick */
/* a class per component, then "Copy spec" and send it over.           */
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
const STORAGE_KEY = "muminmuggar-type-tool-v2";
const DEFAULT_SCALE = { "t-h1": 1.75, "t-h2": 1.25, "t-h3": 1.125, "t-body": 1, "t-ui": 0.9375, "t-label": 0.875, "t-secondary": 0.8125, "t-caption": 0.75, "t-tiny": 0.6875 };

const Mug = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 17h20v13a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z" />
    <path d="M33 20h3.5a4.5 4.5 0 0 1 0 9H33" />
  </svg>
);

const ELEMENTS = [
  { id: "header-title", label: "Header title", css: ".title h1", def: "t-h1",
    render: (s) => <h1 style={s}>Muminmuggar</h1> },
  { id: "header-version", label: "Header version", css: ".ver", def: "t-tiny",
    render: (s) => <span className="ver" style={s}>v1.58.0</span> },
  { id: "tab", label: "Tab label", css: ".tabbtn", def: "t-ui",
    render: (s) => <button className="tabbtn active" style={s}>Samlingen</button> },
  { id: "input", label: "Text field", css: "input", def: "t-ui",
    render: (s) => <input style={s} placeholder="Sök mugg…" readOnly /> },
  { id: "field-label", label: "Field label", css: "label", def: "t-secondary",
    render: (s) => <label style={s}>Skick</label> },
  { id: "btn-primary", label: "Button — primary", css: ".primary", def: "t-label",
    render: (s) => <button className="primary" style={s}>Lägg till</button> },
  { id: "btn-secondary", label: "Button — secondary", css: "button", def: "t-label",
    render: (s) => <button style={s}>Stäng</button> },
  { id: "btn-link", label: "Button — link", css: ".linkbtn", def: "t-ui",
    render: (s) => <button className="linkbtn" style={s}>Avbryt</button> },
  { id: "badge", label: "Badge", css: ".badge", def: "t-caption",
    render: (s) => <span className="badge owned" style={s}>Äger</span> },
  { id: "chip", label: "Chip", css: ".chip", def: "t-caption",
    render: (s) => <span className="chip" style={s}>limiterad</span> },
  { id: "mugrow-name", label: "List row — name", css: ".mugrow-name", def: "t-h3",
    render: (s) => (
      <div className="mugrow" style={{ width: "100%" }}>
        <div className="mugrow-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Mug size={30} /></div>
        <div className="mugrow-main">
          <div className="mugrow-name" style={s}>Moomintroll</div>
          <div className="mini">1990 · ≈ 250 kr</div>
        </div>
      </div>
    ) },
  { id: "mugrow-meta", label: "List row — meta", css: ".mini", def: "t-secondary",
    render: (s) => <div className="mini" style={s}>1990 · ≈ 250 kr</div> },
  { id: "mugcard-name", label: "Grid card — name", css: ".mugname", def: "t-body",
    render: (s) => <div className="mugname" style={s}>Moomintroll</div> },
  { id: "mugcard-sub", label: "Grid card — sub", css: ".mugbody .sub", def: "t-secondary",
    render: (s) => <div className="sub" style={s}>Arabia Moomin · 1990</div> },
  { id: "addmenu", label: "Add menu — item", css: ".addmenu-item", def: "t-h3",
    render: (s) => <button className="addmenu-item" style={{ ...s, animation: "none" }}><span>Ta foto</span></button> },
  { id: "dialog-title", label: "Dialog title", css: ".modal h2", def: "t-h2",
    render: (s) => <h2 style={s}>Lägg till mugg</h2> },
  { id: "help", label: "Help / hint text", css: ".help", def: "t-secondary",
    render: (s) => <div className="help" style={s}>Sök i katalogen och lägg till med ett tryck.</div> },
  { id: "kpi-label", label: "Stat — label", css: ".kpilabel", def: "t-secondary",
    render: (s) => <div className="kpilabel" style={s}>Ägda</div> },
  { id: "kpi-value", label: "Stat — value", css: ".kpivalue", def: "t-h1",
    render: (s) => <div className="kpivalue" style={s}>42</div> },
  { id: "deal-title", label: "Deal row — title", css: ".dealrow-title", def: "t-body",
    render: (s) => <div className="dealrow-title" style={s}>Muminmugg Moomintroll 1990</div> },
  { id: "deal-price", label: "Deal row — price", css: ".dealrow-price-main", def: "t-h2",
    render: (s) => <span className="dealrow-price-main" style={s}>Bud 250 kr</span> },
  { id: "empty-title", label: "Empty state — title", css: ".t-h2", def: "t-h2",
    render: (s) => <div className="t-h2" style={s}>Börja din samling</div> },
  { id: "empty-sub", label: "Empty state — sub", css: ".sub", def: "t-secondary",
    render: (s) => <div className="sub" style={s}>Fotografera flera muggar samtidigt — en hel hylla går bra.</div> },
  { id: "pick-name", label: "Picker — name", css: ".pickname", def: "t-ui",
    render: (s) => <span className="pickname" style={s}>Moomintroll</span> },
  { id: "pick-meta", label: "Picker — meta", css: ".pickmeta", def: "t-caption",
    render: (s) => <span className="pickmeta" style={s}>1990 · 0,4 L</span> },
];

const defaults = () => ({
  scale: { ...DEFAULT_SCALE },
  vals: Object.fromEntries(ELEMENTS.map((el) => [el.id, { cls: el.def, rem: 1 }])),
});

export default function TypeTool() {
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [vals, setVals] = useState(() => defaults().vals);
  const [copied, setCopied] = useState(false);

  // The app shell locks body scrolling; let this page scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Load saved state, and sync the scale from the real CSS variables.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.vals) setVals((v) => ({ ...v, ...saved.vals }));
    } catch { /* ignore */ }
    const cs = getComputedStyle(document.documentElement);
    const m = {};
    for (const s of SCALE) {
      const n = parseFloat(cs.getPropertyValue(s.v));
      if (Number.isFinite(n) && n > 0) m[s.cls] = n;
    }
    if (Object.keys(m).length) setScale((sc) => ({ ...sc, ...m }));
  }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale, vals })); } catch { /* ignore */ } }, [scale, vals]);

  const update = (id, patch) => setVals((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  const styleFor = (val) => (val.cls === "custom" ? { fontSize: `${val.rem}rem` } : { fontSize: `var(${VAR_OF[val.cls]})` });
  const scaleStyle = Object.fromEntries(SCALE.map((s) => [s.v, `${scale[s.cls]}rem`]));

  const specText = () => {
    const head = "Muminmuggar type spec (base 16px)\n\nScale:";
    const scaleLines = SCALE.map((s) => `  ${s.name.padEnd(9)} ${scale[s.cls]}rem`);
    const comp = "\n\nComponents:";
    const compLines = ELEMENTS.map((el) => {
      const v = vals[el.id];
      const size = v.cls === "custom" ? `${v.rem}rem (custom)` : v.cls;
      return `  ${el.id.padEnd(18)} ${size.padEnd(14)} ${el.css}`;
    });
    return [head, ...scaleLines, comp, ...compLines].join("\n");
  };
  const copySpec = async () => {
    const text = specText();
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Copy this:", text); }
  };
  const reset = () => { const d = defaults(); setScale(d.scale); setVals(d.vals); };
  const toggleTheme = () => {
    const el = document.documentElement;
    const isDark = el.getAttribute("data-theme") === "dark"
      || (!el.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    el.setAttribute("data-theme", isDark ? "light" : "dark");
  };

  return (
    <div className={css.wrap}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>Type scale tool</h1>
          <p className={css.sub}>Tune the scale below, and/or pick a class for each component. When you&apos;re happy, hit <b>Copy spec</b> and send me the text.</p>
        </div>
        <div className={css.toolbar}>
          <button className="ghost icon" onClick={toggleTheme} title="Toggle light / dark" aria-label="Toggle theme">◐</button>
          <button onClick={reset}>Reset</button>
          <button className="primary" onClick={copySpec}>{copied ? "Copied!" : "Copy spec"}</button>
        </div>
      </header>

      <section className={css.scalePanel}>
        <div className={css.scaleTitle}>Scale (rem)</div>
        <div className={css.scaleGrid}>
          {SCALE.map((s) => (
            <label key={s.cls} className={css.scaleRow}>
              <span className={css.scaleName}>{s.name}</span>
              <input type="range" min="0.5" max="3" step="0.025" value={scale[s.cls]}
                onChange={(e) => setScale((sc) => ({ ...sc, [s.cls]: Number(e.target.value) }))} aria-label={s.name} />
              <b className={css.scaleVal}>{scale[s.cls]}rem</b>
            </label>
          ))}
        </div>
      </section>

      <div className={css.grid} style={scaleStyle}>
        {ELEMENTS.map((el) => {
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
              <div className={css.preview}>{el.render(styleFor(v))}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
