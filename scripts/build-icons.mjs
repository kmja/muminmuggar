/**
 * Generate every app icon the project needs from a single master.
 *
 *   assets/app-icon.png  (1024x1024, full-bleed)
 *
 *   npm run build:icons
 *
 * Outputs
 *   public/icon-192.png            PWA / Android "any"  (rounded)
 *   public/icon-512.png            PWA / Android "any"  (rounded)
 *   public/icon-maskable-512.png   PWA "maskable"       (full-bleed, safe zone)
 *   public/apple-touch-icon.png    iOS home screen 180  (full-bleed; iOS masks)
 *   app/favicon.ico                browser favicon 16/32/48
 *   extension/icons/icon{16,48,128}.png  Chrome/Edge toolbar
 *
 * The maskable variant re-centres the artwork (the source's mug sits a little
 * right of centre because of the handle) and scales it into the adaptive-icon
 * safe zone.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "app-icon.png");

const BG = { r: 0xf7, g: 0xf3, b: 0xeb, alpha: 1 }; // the master's cream background
const RADIUS = 0.225;                                // tile corner radius (fraction)
const SAFE = 0.66;                                   // maskable: artwork width / canvas

const roundedMask = (s) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">` +
      `<rect width="${s}" height="${s}" rx="${Math.round(s * RADIUS)}" fill="#fff"/></svg>`
  );

async function rounded(size, out) {
  const base = await sharp(SRC).resize(size, size, { fit: "cover" }).png().toBuffer();
  await sharp(base)
    .composite([{ input: roundedMask(size), blend: "dest-in" }])
    .png()
    .toFile(out);
  console.log("  ✓", out.replace(root + "/", ""));
}

async function square(size, out) {
  await sharp(SRC).resize(size, size, { fit: "cover" }).png().toFile(out);
  console.log("  ✓", out.replace(root + "/", ""));
}

/** Bounding box of the non-background pixels on the master. */
async function artworkBox() {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const d = Math.abs(data[i] - BG.r) + Math.abs(data[i + 1] - BG.g) + Math.abs(data[i + 2] - BG.b);
      if (d > 18) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { W, H, minX, maxX, minY, maxY };
}

async function maskable(size, out) {
  const box = await artworkBox();
  const artW = box.maxX - box.minX;
  const factor = (SAFE * size) / artW;
  const resized = await sharp(SRC).resize(Math.round(box.W * factor)).png().toBuffer();
  const acx = (box.minX + box.maxX) / 2;
  const acy = (box.minY + box.maxY) / 2;
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: resized, left: Math.round(size / 2 - acx * factor), top: Math.round(size / 2 - acy * factor) }])
    .png()
    .toFile(out);
  console.log("  ✓", out.replace(root + "/", ""));
}

/** Minimal ICO writer (PNG-encoded entries, Vista+). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

async function favicon(out) {
  const sizes = [16, 32, 48];
  const entries = [];
  for (const s of sizes) {
    entries.push({ size: s, buf: await sharp(SRC).resize(s, s, { fit: "cover" }).png().toBuffer() });
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, ico(entries));
  console.log("  ✓", out.replace(root + "/", ""));
}

console.log("Building icons from assets/app-icon.png");
await rounded(192, join(root, "public", "icon-192.png"));
await rounded(512, join(root, "public", "icon-512.png"));
await maskable(512, join(root, "public", "icon-maskable-512.png"));
await square(180, join(root, "public", "apple-touch-icon.png"));
await favicon(join(root, "app", "favicon.ico"));
await rounded(16, join(root, "extension", "icons", "icon16.png"));
await rounded(48, join(root, "extension", "icons", "icon48.png"));
await rounded(128, join(root, "extension", "icons", "icon128.png"));
console.log("Done.");
