"use client";

import { useEffect, useMemo, useState } from "react";
import MASTER_CATALOG from "../../lib/master-catalog.json";
import { matchMug, warmUp, isReady, getProgress } from "../../lib/image-match";

/* Local-only labeling page: click through a folder of real photos and record the
 * correct catalogue mug for each. Saves to labels.jsonl (via /api/labels) for the
 * fine-tuning script. Reachable at /label when running the app locally. */

const imgSrc = (name) => `/api/label-images/${encodeURIComponent(name)}`;
const svName = (num, fallback) => (MASTER_CATALOG.find((e) => e.num === num)?.nameSv) || fallback;

export default function LabelPage() {
  const [files, setFiles] = useState(null);
  const [labels, setLabels] = useState({});
  const [idx, setIdx] = useState(0);
  const [match, setMatch] = useState(null); // { candidates, embedding, model }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [pct, setPct] = useState(0);

  useEffect(() => { warmUp(); }, []);
  useEffect(() => {
    const id = setInterval(() => setPct(getProgress()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const a = await (await fetch("/api/label-images")).json();
        const list = a.files || [];
        setFiles(list);
        if (a.error) setError(a.error);
        const b = await (await fetch("/api/labels")).json();
        const map = {};
        for (const r of b.rows || []) map[r.file] = r;
        setLabels(map);
        const first = list.findIndex((f) => !map[f]);
        setIdx(first < 0 ? list.length : first);
      } catch (e) { setError(String(e)); setFiles([]); }
    })();
  }, []);

  useEffect(() => {
    if (!files || idx >= files.length) return;
    let cancelled = false;
    (async () => {
      setBusy(true); setError(""); setMatch(null); setShowAll(false); setSearch("");
      try {
        const r = await matchMug(imgSrc(files[idx]), { topK: 4 });
        if (!cancelled) setMatch(r);
      } catch (e) { if (!cancelled) setError("Match failed: " + String(e)); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [files, idx]);

  const choose = async (num, nameEn) => {
    const file = files[idx];
    const candidates = (match?.candidates || []).map((c) => c.num);
    setLabels((m) => ({ ...m, [file]: { file, chosenNum: num } }));
    fetch("/api/labels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, chosenNum: num, chosenName: nameEn, candidates, embedding: match?.embedding }),
    }).catch(() => {});
    setIdx((i) => i + 1);
  };
  const skip = () => setIdx((i) => i + 1);
  const back = () => setIdx((i) => Math.max(0, i - 1));

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

  const allList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = MASTER_CATALOG.filter((e) => !q || `${e.nameEn} ${e.nameSv || ""} ${e.year}`.toLowerCase().includes(q));
    return list.slice(0, 80);
  }, [search]);

  const done = files && idx >= files.length;
  const labeled = Object.keys(labels).length;

  return (
    <div className="wrap" style={{ maxWidth: 760, paddingBottom: 40 }}>
      <div className="top">
        <div className="title"><h1>Label mugs</h1><span className="ver">{files ? `${Math.min(idx + 1, files.length)} / ${files.length} · ${labeled} labeled` : "loading…"}</span></div>
        <div className="actions"><a className="ghost icon" href="/" title="Back to app" style={{ textDecoration: "none" }}>×</a></div>
      </div>

      {error ? <div className="note warn" style={{ marginBottom: 12 }}>{error}</div> : null}
      {files && files.length === 0 ? <div className="note">Put photos in <code>label-images/</code> at the project root and reload.</div> : null}

      {done ? (
        <div className="card pad" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20 }}>All done</div>
          <div className="sub" style={{ marginTop: 6 }}>{labeled} labeled → saved to <code>labels.jsonl</code>.</div>
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button onClick={() => setIdx(0)}>Review from start</button>
          </div>
        </div>
      ) : null}

      {!done && files && files.length ? (
        <>
          <img src={imgSrc(files[idx])} alt="" style={{ width: "100%", maxHeight: "46vh", objectFit: "contain", borderRadius: 12, background: "var(--bg2)" }} />

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
