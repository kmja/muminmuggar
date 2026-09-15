import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "label-images");
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".tif", ".tiff", ".bmp"]);

/** List the local labeling photos. Labeling is a local-only workflow. */
export async function GET() {
  try {
    const files = (await readdir(DIR))
      .filter((f) => EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return NextResponse.json({ dir: "label-images", files });
  } catch {
    return NextResponse.json({ dir: "label-images", files: [], error: "No label-images folder on this server — labeling runs locally." });
  }
}
