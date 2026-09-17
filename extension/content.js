// Adds a small floating button on mukify.com that imports the whole collection
// into Muminmuggar (the request runs in the service worker, with your session).
(() => {
  const ID = "muminmuggar-import-btn";
  if (document.getElementById(ID)) return;

  const btn = document.createElement("button");
  btn.id = ID;
  btn.type = "button";
  btn.textContent = "Importera till Muminmuggar";
  btn.title = "Importera hela din Mukify-samling till Muminmuggar";

  const reset = (label, delay) => window.setTimeout(() => { btn.textContent = label; btn.disabled = false; }, delay);

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Importerar…";
    try {
      const res = await chrome.runtime.sendMessage({ type: "runImport" });
      if (res && res.ok) {
        const r = res.result;
        btn.textContent = `Klart: ${r.created} tillagda · ${r.skipped} fanns redan · ${r.unmatched} okända`;
        reset("Importera till Muminmuggar", 7000);
      } else {
        const msg = res && res.error === "NOT_CONNECTED"
          ? "Anslut tillägget först: klicka på tilläggets ikon och klistra in anslutningskoden."
          : (res && res.error) || "Något gick fel.";
        alert("Muminmuggar: " + msg);
        reset("Importera till Muminmuggar", 0);
      }
    } catch (e) {
      alert("Muminmuggar: " + ((e && e.message) || e));
      reset("Importera till Muminmuggar", 0);
    }
  });

  const mount = () => document.body && document.body.appendChild(btn);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
