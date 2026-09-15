import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "label-images");
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".avif": "image/avif", ".heic": "image/heic", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp",
};

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const name = path.basename(decodeURIComponent(params.name));
  const type = MIME[path.extname(name).toLowerCase()];
  if (!type) return new NextResponse("not found", { status: 404 });
  try {
    const buf = await readFile(path.join(DIR, name));
    return new NextResponse(buf, { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
