import sharp from "sharp";
const buf = await sharp("/tmp/mugsrc/love.jpg").rotate().toBuffer();
const m = await sharp(buf).metadata();
console.log("rotated dims", m.width, "x", m.height);
await sharp(buf)
  .extract({ left: 0, top: 0, width: m.width, height: Math.round(m.height * 0.5) })
  .trim({ threshold: 12 })
  .resize({ width: 560, withoutEnlargement: true })
  .webp({ quality: 90 })
  .toFile("public/mugs/love-pink.webp");
const o = await sharp("public/mugs/love-pink.webp").metadata();
console.log("love-pink.webp", o.width + "x" + o.height);
