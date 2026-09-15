import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Collect real-photo labels for the on-device matcher. Each confirmed or
 * corrected match becomes one row: the query feature (embedding), a small
 * thumbnail, the catalogue num the user chose, and the shortlist they chose from.
 * Owner-scoped and best-effort — the client fires these without blocking.
 */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const b = await req.json();
    const embedding = typeof b.embedding === "string" ? b.embedding.slice(0, 20000) : "";
    if (!embedding) return NextResponse.json({ error: "embedding required" }, { status: 400 });
    const thumb = typeof b.thumb === "string" && b.thumb.startsWith("data:image/") ? b.thumb.slice(0, 400000) : null;
    const candidates = Array.isArray(b.candidates)
      ? b.candidates.map(Number).filter((n: unknown) => Number.isInteger(n)).slice(0, 20)
      : [];
    await query(
      `INSERT INTO match_feedback (owner, model, embedding, thumb, chosen_num, chosen_name, auto, candidates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        owner,
        typeof b.model === "string" ? b.model.slice(0, 120) : null,
        embedding,
        thumb,
        Number.isInteger(b.chosenNum) ? b.chosenNum : null,
        typeof b.chosenName === "string" ? b.chosenName.slice(0, 200) : null,
        Boolean(b.auto),
        candidates,
      ],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Export the caller's collected labels (metadata + embeddings) for training. */
export async function GET() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const { rows } = await query(
      `SELECT id, model, embedding, chosen_num, chosen_name, auto, candidates, created_at,
              (thumb IS NOT NULL) AS has_thumb
       FROM match_feedback WHERE owner = $1 ORDER BY id DESC LIMIT 20000`,
      [owner],
    );
    return NextResponse.json({ count: rows.length, rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
