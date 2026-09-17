const $ = (id) => document.getElementById(id);

async function refresh() {
  const { importToken } = await chrome.storage.local.get("importToken");
  $("connected").hidden = !importToken;
  $("disconnected").hidden = !!importToken;
  $("msg").textContent = "";
  $("result").textContent = "";
}

$("save").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!token) { $("msg").textContent = "Klistra in koden först."; return; }
  await chrome.storage.local.set({ importToken: token });
  await refresh();
});

$("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove("importToken");
  await refresh();
});

$("import").addEventListener("click", async () => {
  $("result").textContent = "Importerar…";
  const res = await chrome.runtime.sendMessage({ type: "runImport" });
  if (res && res.ok) {
    const r = res.result;
    $("result").textContent = `Klart: ${r.created} tillagda · ${r.skipped} fanns redan · ${r.unmatched} okända.`;
  } else {
    $("result").textContent = "Fel: " + ((res && res.error) || "okänt");
  }
});

refresh();
