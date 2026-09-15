import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ownerFromRequest } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the owner's labels as JSONL (same shape as the local labels.jsonl). */
export async function GET(req: Request) {
  const owner = await ownerFromRequest(req);
  if (!owner) return new NextResponse("unauthorized", { status: 401 });
  const { rows } = await query(
    "SELECT name, chosen_num, chosen_name, candidates, embedding, created_at FROM labels WHERE owner = $1 AND chosen_num IS NOT NULL ORDER BY id",
    [owner],
  );
  const lines = rows.map((r) =>
    JSON.stringify({ file: r.name, chosenNum: Number(r.chosen_num), chosenName: r.chosen_name, candidates: r.candidates || [], embedding: r.embedding, ts: r.created_at }),
  );
  return new NextResponse(lines.length ? lines.join("\n") + "\n" : "", {
    headers: { "content-type": "application/x-ndjson", "content-disposition": 'attachment; filename="labels.jsonl"' },
  });
}
