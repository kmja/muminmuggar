"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Download, Trash2, Sparkles, CheckCircle2, XCircle, ImagePlus } from "lucide-react";
import { embedImage, warmUp, isReady, getProgress } from "../../lib/image-match";
import {
  addSample, clearSamples, sampleCounts, trainLocal, clearLocalHead,
  getGate, exportSamples, loadGlobalGate, gateThreshold,
} from "../../lib/gate";
import css from "./train.module.css";

/* ------------------------------------------------------------------ */
/* Live trainer for the mug / not-mug gate. Photograph mugs and things  */
/* that are not mugs; the features are computed on-device and a small   */
/* logistic regression learns the boundary. Train here to try it out,   */
/* then Export so it can be baked into public/mug-gate.json for all.    */
/* ------------------------------------------------------------------ */

function downscale(dataUrl, max) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function TrainPage() {
  const [label, setLabel] = useState(1); // 1 = mugg, 0 = inte mugg
  const [counts, setCounts] = useState({ pos: 0, neg: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [training, setTraining] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);
  const [pct, setPct] = useState(0);
  const [head, setHead] = useState(null);
  const [camErr, setCamErr] = useState("");
  const [camReady, setCamReady] = useState(false);
  const videoRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setCounts(sampleCounts());
    setHead(getGate());
    warmUp();
    loadGlobalGate().then(() => setHead(getGate()));
  }, []);
  useEffect(() => {
    const id = setInterval(() => { setReady(isReady()); setPct(getProgress()); }, 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let cancelled = false, stream;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamErr("Kameran är inte tillgänglig — använd Välj bild."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); setCamReady(true); }
      } catch { if (!cancelled) setCamErr("Kameran nekades — använd Välj bild."); }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const save = async (dataUrl) => {
    setBusy(true); setMsg("Räknar ut bildvektorn…");
    try {
      const small = await downscale(dataUrl, 1400);
      const { vec } = await embedImage(small);
      addSample(vec, label);
      setCounts(sampleCounts());
      setMsg(label ? "Sparade en mugg ✓" : "Sparade en icke-mugg ✓");
    } catch (e) { setMsg("Fel: " + (e?.message || e)); }
    finally { setBusy(false); }
  };
  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    save(c.toDataURL("image/jpeg", 0.9));
  };
  const choose = async (file) => {
    if (!file) return;
    const raw = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    save(raw);
  };

  const train = async () => {
    setTraining(true); setMsg("");
    // Yield a frame so the "Tränar…" state paints before the fit runs — the fit
    // is synchronous and blocks the main thread, so without this it looks hung.
    await new Promise((r) => setTimeout(r, 50));
    try {
      const res = trainLocal();
      if (res.error === "too-few") setMsg("Ta minst 8 bilder, både muggar och icke-muggar.");
      else if (res.error === "one-class") setMsg("Du behöver både mugg- och icke-mugg-bilder.");
      setHead(getGate());
    } finally { setTraining(false); }
  };
  const exportAll = () => {
    if (!counts.total) { setMsg("Inga bilder att exportera."); return; }
    const blob = new Blob([exportSamples()], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mug-gate-samples.jsonl";
    a.click();
    setMsg("Exporterade " + counts.total + " bildvektorer.");
  };
  const clear = () => {
    if (!window.confirm("Rensa alla sparade bildvektorer och den tränade modellen?")) return;
    clearSamples(); clearLocalHead();
    setCounts(sampleCounts()); setHead(getGate()); setMsg("Rensat.");
  };

  const isLocal = head?.meta?.source === "local";
  const acc = head?.meta?.accuracy;
  const trainedN = (head?.meta?.pos ?? 0) + (head?.meta?.neg ?? 0);
  const stale = isLocal && counts.total > trainedN;

  return (
    <main className={css.wrap}>
      <h1 className={css.h1}>Träna mugg-igenkänning</h1>
      <p className={css.lead}>
        Fota muggar och saker som <em>inte</em> är muggar. Appen räknar ut en bildvektor på enheten och
        tränar en liten modell som lär sig skillnaden — så fotot av ett bord inte längre ger fyra muggförslag.
        Sikta på minst 20 av varje, i olika ljus och vinklar.
      </p>

      <div className={css.toggle}>
        <button className={label ? css.on : ""} onClick={() => setLabel(1)}><CheckCircle2 size={16} /> Mugg</button>
        <button className={!label ? css.on : ""} onClick={() => setLabel(0)}><XCircle size={16} /> Inte mugg</button>
      </div>
      <p className={css.hint}>Nästa bild sparas som: <strong>{label ? "mugg" : "inte mugg"}</strong></p>

      <div className={css.cam}>
        {camErr ? (
          <div className={css.camph}><Camera size={36} /><span>{camErr}</span></div>
        ) : (
          <>
            <video ref={videoRef} className={css.video} autoPlay playsInline muted />
            <button className={css.shutter} onClick={capture} disabled={!camReady || busy} aria-label="Ta bild" />
          </>
        )}
      </div>
      <div className={css.row}>
        <button className="big" onClick={() => fileRef.current?.click()} disabled={busy}><ImagePlus size={16} /> Välj bild</button>
        <input ref={fileRef} className="sr-only" type="file" accept="image/*" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        <span className={css.counts}>
          <CheckCircle2 size={15} /> {counts.pos} muggar · <XCircle size={15} /> {counts.neg} icke
        </span>
      </div>

      <div className={css.actions}>
        <button className="primary big" onClick={train} disabled={busy || training || counts.total < 8}>
          {training ? <span className={css.spinner} aria-hidden="true" /> : <Sparkles size={16} />} {training ? "Tränar…" : "Träna"}
        </button>
        <button className="big" onClick={exportAll} disabled={!counts.total}><Download size={16} /> Exportera träningsdata</button>
        <button className="big" onClick={clear} disabled={!counts.total && !head}><Trash2 size={16} /> Rensa</button>
      </div>

      {msg ? <div className={css.msg}>{msg}</div> : null}
      {busy && !ready ? <div className={css.msg}>Laddar bildmodellen… {Math.round(pct)}%</div> : null}

      <div className={css.banner + (training ? " " + css.bannerBusy : isLocal ? " " + css.bannerOk : "")} role="status">
        {training ? (
          <><span className={css.spinner} aria-hidden="true" /> Tränar modellen…</>
        ) : isLocal ? (
          <><CheckCircle2 size={16} /> Tränad på den här enheten{acc != null ? ` · träffsäkerhet ${Math.round(acc * 100)}%` : ""} ({head.meta.pos} muggar / {head.meta.neg} icke)</>
        ) : head ? (
          <>Global modell inläst{acc != null ? ` · träffsäkerhet ${Math.round(acc * 100)}%` : ""}</>
        ) : (
          <>Ingen modell än — fota lite av varje och tryck Träna.</>
        )}
      </div>
      {stale ? (
        <div className={css.warn}>{counts.total - trainedN} nya bilder sedan träningen — tryck Träna igen för att ta med dem.</div>
      ) : null}

      <div className={css.status}>
        <div>
          <strong>Tröskel:</strong> P(mugg) ≥ {gateThreshold().toFixed(2)}
          {head?.meta?.builtAt ? ` · byggd ${new Date(head.meta.builtAt).toLocaleString()}` : ""}
        </div>
        <div className={css.note}>
          En lokal modell gäller bara på den här enheten. <strong>Exportera träningsdata</strong> laddar ner bildvektorerna
          (inte modellen) — skicka filen så bakas den in i <code>public/mug-gate.json</code> och gäller alla användare.
        </div>
      </div>
    </main>
  );
}
