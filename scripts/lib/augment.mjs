// Shared training-time augmentation: composite a catalogue mug onto a random
// scene, with rotation/scale/lighting/JPEG variation. Used by the embeddings
// builder and the label trainer so both see the same distribution.
import sharp from "sharp";

const rnd = (a, b) => a + Math.random() * (b - a);

const COLS = ["#7d8a6a", "#8a7a6a", "#6a7d8a", "#8a6a7d", "#a8b0a0", "#5a4a3a", "#3a4a5a", "#c0b8a8", "#2a2a2a", "#e0d8c8", "#b0a890", "#4a5a4a", "#e8d24a", "#2a6ad8", "#d83a3a", "#3ad86a", "#111111", "#ffffff"];
function scene() {
  const c1 = COLS[Math.floor(Math.random() * COLS.length)];
  const c2 = COLS[Math.floor(Math.random() * COLS.length)];
  return `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/></svg>`;
}

export async function augment(imagePath) {
  const scale = rnd(0.55, 1.3), angle = rnd(-20, 20), q = Math.round(rnd(30, 70));
  let mug = sharp(imagePath).resize({ width: Math.round(430 * scale) });
  if (Math.random() < 0.5) mug = mug.modulate({ brightness: rnd(0.8, 1.2), saturation: rnd(0.8, 1.2) });
  return sharp(Buffer.from(scene())).resize(800, 800)
    .composite([{ input: await mug.png().toBuffer(), gravity: "center" }])
    .rotate(angle, { background: { r: 110, g: 110, b: 100 } })
    .jpeg({ quality: q }).toBuffer();
}
