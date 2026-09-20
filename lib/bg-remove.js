/* On-device background removal for photo matching.
 *
 * The matcher's probe is trained on catalogue cutouts composited onto synthetic
 * backgrounds, so a real photo (kitchen, table, lamp) is dominated by its
 * background and matches poorly. We cut the subject out with RMBG-1.4 (runs in
 * the browser, nothing uploaded), then re-frame it — cropped to the subject and
 * centred on a neutral background — so it looks like the training views.
 */

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
// Hide the dynamic import from the bundler so it stays a runtime CDN import.
const importModule = new Function("u", "return import(u)");

// RMBG-1.4's own preprocessing config (its pipeline isn't in transformers.js).
const PROCESSOR_CONFIG = {
  do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
  image_mean: [0.5, 0.5, 0.5], feature_extractor_type: "ImageFeatureExtractor",
  image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098,
  size: { width: 1024, height: 1024 },
};

const BG = "#ecebe7"; // neutral backdrop the subject is composited onto
const OUT = 448;      // output canvas size
const FILL = 0.78;    // subject occupies this fraction of the canvas

let tfPromise = null;
let modelPromise = null;
let processorPromise = null;
let ready = false;
let loadProgress = 0;

function getTF() {
  if (!tfPromise) tfPromise = importModule(TRANSFORMERS_CDN);
  return tfPromise;
}

function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { AutoModel } = await getTF();
      const m = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
        config: { model_type: "custom" },
        dtype: "q8",
        progress_callback: (p) => { if (p && typeof p.progress === "number") loadProgress = p.progress; },
      });
      ready = true;
      return m;
    })();
  }
  return modelPromise;
}

function getProcessor() {
  if (!processorPromise) {
    processorPromise = (async () => {
      const { AutoProcessor } = await getTF();
      return AutoProcessor.from_pretrained("briaai/RMBG-1.4", { config: PROCESSOR_CONFIG });
    })();
  }
  return processorPromise;
}

/** Start downloading the background-removal model in the background. */
export function warmUpBg() {
  getModel().catch(() => {});
}

/** True once the model has finished loading. */
export function isBgReady() {
  return ready;
}

/** Download progress of the model files, 0–100. */
export function getBgProgress() {
  return loadProgress;
}

/**
 * Remove the background from an image data URL and return a new data URL with the
 * subject cropped and centred on a neutral backdrop. Throws if the model can't
 * load — callers should fall back to the original photo.
 */
export async function removeBackground(dataUrl) {
  const [{ RawImage }, model, processor] = await Promise.all([getTF(), getModel(), getProcessor()]);
  const img = await RawImage.fromURL(dataUrl);
  const { pixel_values } = await processor(img);
  const out = await model({ input: pixel_values });
  const o = out[Object.keys(out)[0]];
  const t = o.dims.length === 4 ? o[0] : o; // [1, H, W] in 0–1
  const mask = await RawImage.fromTensor(t.mul(255).to("uint8")).resize(img.width, img.height);
  return composite(img, mask.data, mask.width, mask.height);
}

/** Crop to the mask's bounding box and centre it on a neutral canvas. */
function composite(img, mask, W, H) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] > 128) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; } // no subject → keep the frame
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const pad = Math.round(0.06 * Math.max(bw, bh));
  const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
  const cw = Math.min(W - cx, bw + pad * 2), ch = Math.min(H - cy, bh + pad * 2);

  // The subject with the background knocked out (soft-edged alpha).
  const crop = document.createElement("canvas");
  crop.width = cw; crop.height = ch;
  const cctx = crop.getContext("2d");
  const cim = cctx.createImageData(cw, ch);
  const n = img.channels;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (cy + y) * W + (cx + x), di = (y * cw + x) * 4;
      cim.data[di] = img.data[si * n];
      cim.data[di + 1] = img.data[si * n + 1];
      cim.data[di + 2] = img.data[si * n + 2];
      const a = mask[si];
      cim.data[di + 3] = a < 32 ? 0 : a > 224 ? 255 : Math.round(((a - 32) * 255) / 192);
    }
  }
  cctx.putImageData(cim, 0, 0);

  const out = document.createElement("canvas");
  out.width = OUT; out.height = OUT;
  const octx = out.getContext("2d");
  octx.fillStyle = BG; octx.fillRect(0, 0, OUT, OUT);
  const scale = Math.min((OUT * FILL) / cw, (OUT * FILL) / ch);
  const dw = cw * scale, dh = ch * scale;
  octx.drawImage(crop, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh);
  return out.toDataURL("image/jpeg", 0.9);
}
