import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUT = path.join(process.cwd(), "labels.jsonl");

interface LabelRow { file: string; chosenNum: number | null; chosenName?: string | null; candidates?: number[]; embedding?: string; ts?: string }

async function readAll(): Promise<Record<string, LabelRow>> {
  try {
    const txt = await readFile(OUT, "utf8");
    const map: Record<string, LabelRow> = {};
    for (const line of txt.split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line) as LabelRow; if (j.file) map[j.file] = j; } catch { /* skip */ }
    }
    return map;
  } catch { return {}; }
}

/** Existing labels (so the page can resume where you left off). */
export async function GET() {
  const map = await readAll();
  const rows = Object.values(map);
  return NextResponse.json({ count: rows.length, rows });
}

/** Record (or clear) one label. Writes labels.jsonl next to the project root. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.file || typeof b.file !== "string") return NextResponse.json({ error: "file required" }, { status: 400 });
    const map = await readAll();
    if (b.chosenNum == null) delete map[b.file];
    else map[b.file] = {
      file: b.file,
      chosenNum: Number.isInteger(b.chosenNum) ? b.chosenNum : null,
      chosenName: typeof b.chosenName === "string" ? b.chosenName : null,
      candidates: Array.isArray(b.candidates) ? b.candidates.map(Number).filter(Number.isInteger) : [],
      embedding: typeof b.embedding === "string" ? b.embedding : undefined,
      ts: new Date().toISOString(),
    };
    const lines = Object.values(map).map((r) => JSON.stringify(r));
    await writeFile(OUT, lines.length ? lines.join("\n") + "\n" : "");
    return NextResponse.json({ ok: true, count: lines.length });
  } catch (e) {
    return NextResponse.json({ error: `Cannot write labels.jsonl here (labeling runs locally). ${(e as Error).message}` }, { status: 500 });
  }
}
