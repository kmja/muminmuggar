import sharp from "sharp";
const jobs = [
  ["/tmp/mugsrc/green.jpg", "public/mugs/mug-green.webp", null],
  ["/tmp/mugsrc/abcae.jpg", "public/mugs/abc-ae.webp", null],
  ["/tmp/mugsrc/love.jpg", "public/mugs/love-pink.webp", { left: 55, top: 0, width: 650, height: 545 }],
];
for (const [src, dst, crop] of jobs) {
  let img = sharp(src);
  if (crop) img = img.extract(crop);
  await img.trim({ threshold: 12 }).resize({ width: 560, withoutEnlargement: true }).webp({ quality: 90 }).toFile(dst);
  const m = await sharp(dst).metadata();
  console.log(dst, m.width + "x" + m.height);
}
