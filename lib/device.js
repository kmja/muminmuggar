/** Stable per-device id so anonymous users still have their own data. */
export function getDeviceId() {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("deviceId");
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID ? crypto.randomUUID() : "d" + Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, "");
      localStorage.setItem("deviceId", id);
    }
    return id;
  } catch { return ""; }
}
