"use client";
import { useEffect, useState } from "react";
import { Plus, Sparkles, BarChart3, Bell, Check } from "lucide-react";
import css from "./icon.module.css";

/* ------------------------------------------------------------------ */
/* Icon explorer — compare candidate app icons, then see the chosen    */
/* one as an iOS / Android launcher icon and in the app header.        */
/* ------------------------------------------------------------------ */

const OPTIONS = [
  { id: "f1", label: "Flat · white", desc: "Flat two-tone · purple tile · white mug", recommended: true },
  { id: "f2", label: "Flat · cream", desc: "Flat two-tone · purple tile · cream mug" },
  { id: "o1", label: "Outline · cream", desc: "Bold outline · cream tile" },
  { id: "o2", label: "Outline · purple", desc: "Bold outline · purple tile" },
  { id: "o3", label: "Outline · open rim", desc: "Bold outline · cream tile · no rim fill" },
  { id: "current", label: "Current", desc: "The icon shipped in the app today" },
];

const src = (id) => `/icon-options/${id}.svg`;

const SIZES = [16, 24, 32, 48, 56, 96, 128, 180];

// dummy neighbours for the home-screen mock
const NEIGHBOURS = [
  { name: "Karta", from: "#7ed0a8", to: "#3f9d74" },
  { name: "Anteckningar", from: "#ffe08a", to: "#e0a92e" },
  { name: "Kamera", from: "#9fb4d8", to: "#5b6f96" },
  { name: "Musik", from: "#f3a3b6", to: "#c85f7d" },
  { name: "Väder", from: "#8fd2ef", to: "#3f8fc4" },
  { name: "Böcker", from: "#c9b6e8", to: "#8b6fb8" },
  { name: "Inställningar", from: "#c9ccd2", to: "#8b9099" },
];

export default function IconExplorer() {
  const [sel, setSel] = useState("f1");

  // The app shell locks body scrolling; let this page scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const chosen = OPTIONS.find((o) => o.id === sel) || OPTIONS[0];
  const icon = src(sel);

  return (
    <div className={css.wrap}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>App icon</h1>
          <p className={css.sub}>
            Candidate marks for Muminmuggar. Pick one below to preview it as an iOS and
            Android launcher icon and inside the app header. The source SVGs live in{" "}
            <code className={css.code}>public/icon-options/</code>.
          </p>
        </div>
      </header>

      {/* ---------------------------- options ---------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Options</div>
        <div className={css.options}>
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={css.opt + (o.id === sel ? " " + css.optOn : "")}
              onClick={() => setSel(o.id)}
              aria-pressed={o.id === sel}
            >
              <span className={css.optArt}>
                <img src={src(o.id)} alt={`${o.label} icon`} />
                {o.id === sel ? <span className={css.optCheck}><Check size={15} /></span> : null}
              </span>
              <span className={css.optMeta}>
                <span className={css.optLabel}>
                  {o.label}
                  {o.recommended ? <em className={css.rec}>recommended</em> : null}
                </span>
                <span className={css.optDesc}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------- iOS home screen ------------------------ */}
      <section className={css.panel}>
        <div className={css.panelTitle}>iOS — home screen</div>
        <div className={css.deviceRow}>
          <div className={css.iphone}>
            <div className={css.notch} />
            <div className={css.iosWall}>
              <div className={css.statusbar}><span>9:41</span><span>􀛨 􀙇 􀛪</span></div>
              <div className={css.appgrid}>
                <div className={css.appcell}>
                  <img className={css.iosIcon} src={icon} alt="" />
                  <span className={css.appName}>Muminmuggar</span>
                </div>
                {NEIGHBOURS.map((n) => (
                  <div className={css.appcell} key={n.name}>
                    <span className={css.iosIcon} style={{ background: `linear-gradient(160deg, ${n.from}, ${n.to})` }} />
                    <span className={css.appName}>{n.name}</span>
                  </div>
                ))}
              </div>
              <div className={css.dock}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={css.dockIcon} />
                ))}
              </div>
            </div>
          </div>
          <div className={css.notes}>
            <h3 className={css.noteTitle}>iOS</h3>
            <ul className={css.noteList}>
              <li>Apple applies its own squircle mask and a subtle top gloss — supply a square, full-bleed 1024×1024 PNG with <b>no</b> rounded corners of its own.</li>
              <li>Our tiles are pre-rounded at ~22%, which matches iOS closely, so the preview is representative.</li>
              <li>Shipped via <code className={css.code}>apple-touch-icon.png</code> (180×180) and the web-app manifest.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------- Android adaptive icon --------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Android — adaptive icon</div>
        <div className={css.masks}>
          {[
            { name: "Circle", cls: css.maskCircle, hint: "Pixel default" },
            { name: "Squircle", cls: css.maskSquircle, hint: "Material You" },
            { name: "Rounded square", cls: css.maskRound, hint: "Samsung / others" },
          ].map((m) => (
            <figure className={css.maskFig} key={m.name}>
              <span className={css.maskWrap}>
                <img className={css.maskImg + " " + m.cls} src={icon} alt="" />
              </span>
              <figcaption className={css.maskCap}>
                <b>{m.name}</b>
                <span>{m.hint}</span>
              </figcaption>
            </figure>
          ))}
          <figure className={css.maskFig}>
            <span className={css.maskWrap + " " + css.safeWrap}>
              <img className={css.maskImg + " " + css.maskCircle} src={icon} alt="" />
              <span className={css.safeRing} />
            </span>
            <figcaption className={css.maskCap}>
              <b>Safe zone</b>
              <span>content stays inside the dashed circle</span>
            </figcaption>
          </figure>
        </div>
        <p className={css.note}>
          Android composites two 108dp layers and crops them to the device's mask. The
          mark is well inside the safe zone, so it survives every mask. For the maskable
          asset I'll export a full-bleed square (background to the edges, no pre-rounded
          corners) so nothing shows through under aggressive masks.
        </p>
      </section>

      {/* --------------------------- app header --------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>In the app header</div>
        <div className={css.headerPreview}>
          <header className="top">
            <div className="topbar">
              <div className="brand">
                <img className={css.brandIcon} src={icon} alt="" />
                <div className="title">
                  <h1>Muminmuggar</h1>
                  <span className="ver">v1.75.0</span>
                </div>
              </div>
              <div className="actions">
                <button className="primary hide-mobile"><Plus size={16} /> Lägg till</button>
                <button className="hide-mobile"><Sparkles size={16} /> Luckor</button>
                <button className="ghost icon"><BarChart3 size={18} /></button>
                <button className="ghost icon"><Bell size={18} /></button>
              </div>
            </div>
            <svg className="topwave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0,22 C180,40 360,4 720,16 C1080,28 1260,40 1440,14 L1440,0 L0,0 Z" />
            </svg>
          </header>
        </div>
        <p className={css.note}>
          The brand currently shows only the title — this is the mark added to its left, at
          40px with a ~11px corner radius. Tap targets and the wave are unchanged.
        </p>
      </section>

      {/* ----------------------------- sizes ----------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Sizes</div>
        <div className={css.sizeStrip}>
          {SIZES.map((s) => (
            <div className={css.sizeCell} key={s}>
              <img src={icon} alt="" width={s} height={s} style={{ width: s, height: s }} />
              <span className={css.sizeLabel}>{s}px</span>
            </div>
          ))}
          <div className={css.sizeCell}>
            <span className={css.sizeMaster}>512</span>
            <span className={css.sizeLabel}>master</span>
          </div>
        </div>
      </section>

      <p className={css.footer}>
        Selected: <b>{chosen.label}</b> — {chosen.desc} · <code className={css.code}>{icon}</code>
      </p>
    </div>
  );
}
