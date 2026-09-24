"use client";
import { useEffect } from "react";
import { Plus, Sparkles, BarChart3, Bell } from "lucide-react";
import css from "./icon.module.css";

/* ------------------------------------------------------------------ */
/* Where the app icon shows up. Read-only preview of the shipped       */
/* assets — regenerate them from assets/app-icon.png with             */
/* `npm run build:icons`.                                             */
/* ------------------------------------------------------------------ */

const SHIPPED = [
  { file: "public/icon-192.png", note: "PWA / Android “any” · rounded" },
  { file: "public/icon-512.png", note: "PWA / Android “any” · rounded" },
  { file: "public/icon-maskable-512.png", note: "PWA “maskable” · full-bleed, safe zone" },
  { file: "public/apple-touch-icon.png", note: "iOS home screen · 180, full-bleed" },
  { file: "app/favicon.ico", note: "Browser tab · 16 / 32 / 48" },
  { file: "extension/icons/icon{16,48,128}.png", note: "Chrome / Edge toolbar" },
];

const SIZES = [16, 24, 32, 48, 56, 96, 128, 180];
const ANY = "/icon-512.png";
const MASKABLE = "/icon-maskable-512.png";
const APPLE = "/apple-touch-icon.png";

const NEIGHBOURS = [
  { name: "Karta", from: "#7ed0a8", to: "#3f9d74" },
  { name: "Anteckningar", from: "#ffe08a", to: "#e0a92e" },
  { name: "Kamera", from: "#9fb4d8", to: "#5b6f96" },
  { name: "Musik", from: "#f3a3b6", to: "#c85f7d" },
  { name: "Väder", from: "#8fd2ef", to: "#3f8fc4" },
  { name: "Böcker", from: "#c9b6e8", to: "#8b6fb8" },
  { name: "Inställningar", from: "#c9ccd2", to: "#8b9099" },
];

export default function IconPreview() {
  // The app shell locks body scrolling; let this page scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className={css.wrap}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>App icon</h1>
          <p className={css.sub}>
            The shipped icon, in the places it appears. Regenerate every asset from{" "}
            <code className={css.code}>assets/app-icon.png</code> with{" "}
            <code className={css.code}>npm run build:icons</code>.
          </p>
        </div>
      </header>

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
                  <img className={css.iosIcon} src={APPLE} alt="" />
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
                {[0, 1, 2, 3].map((i) => <span key={i} className={css.dockIcon} />)}
              </div>
            </div>
          </div>
          <div className={css.notes}>
            <h3 className={css.noteTitle}>iOS</h3>
            <ul className={css.noteList}>
              <li>Served as <code className={css.code}>apple-touch-icon.png</code> (180×180) and declared in <code className={css.code}>app/layout.tsx</code>.</li>
              <li>Supplied full-bleed (no rounded corners) — iOS applies its own squircle mask and gloss.</li>
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
                <img className={css.maskImg + " " + m.cls} src={MASKABLE} alt="" />
              </span>
              <figcaption className={css.maskCap}><b>{m.name}</b><span>{m.hint}</span></figcaption>
            </figure>
          ))}
          <figure className={css.maskFig}>
            <span className={css.maskWrap + " " + css.safeWrap}>
              <img className={css.maskImg + " " + css.maskCircle} src={MASKABLE} alt="" />
              <span className={css.safeRing} />
            </span>
            <figcaption className={css.maskCap}><b>Safe zone</b><span>content inside the dashed circle</span></figcaption>
          </figure>
        </div>
        <p className={css.note}>
          Declared as <code className={css.code}>purpose: "maskable"</code> in{" "}
          <code className={css.code}>public/manifest.json</code>. The maskable asset is
          full-bleed with the mug re-centred and scaled into the safe zone, so it survives
          every device mask.
        </p>
      </section>

      {/* --------------------------- app header --------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Browser tab &amp; app header</div>
        <div className={css.headerPreview}>
          <header className="top">
            <div className="topbar">
              <div className="brand">
                <img className={css.brandIcon} src="/icon-192.png" alt="" />
                <div className="title">
                  <h1>Muminmuggar</h1>
                  <span className="ver">v1.77.0</span>
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
          The browser tab uses <code className={css.code}>app/favicon.ico</code>. The header
          brand still shows only the title — the mark is shown here as a preview, not wired in.
        </p>
      </section>

      {/* ----------------------------- sizes ----------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Sizes</div>
        <div className={css.sizeStrip}>
          {SIZES.map((s) => (
            <div className={css.sizeCell} key={s}>
              <img src={ANY} alt="" width={s} height={s} style={{ width: s, height: s }} />
              <span className={css.sizeLabel}>{s}px</span>
            </div>
          ))}
          <div className={css.sizeCell}>
            <span className={css.sizeMaster}>512</span>
            <span className={css.sizeLabel}>master</span>
          </div>
        </div>
      </section>

      {/* ----------------------------- files ----------------------------- */}
      <section className={css.panel}>
        <div className={css.panelTitle}>Generated files</div>
        <ul className={css.fileList}>
          {SHIPPED.map((f) => (
            <li key={f.file}>
              <code className={css.code}>{f.file}</code>
              <span>{f.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
