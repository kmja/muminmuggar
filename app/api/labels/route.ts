import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner's labels (used to resume labeling and to compute accuracy). */
export async function GET() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const { rows } = await query(
    `SELECT l.id, l.image_id, l.name, l.chosen_num, l.chosen_name, l.candidates, l.embedding, i.name AS image_name
     FROM labels l LEFT JOIN label_images i ON i.id = l.image_id
     WHERE l.owner = $1 ORDER BY l.id`,
    [owner],
  );
  return NextResponse.json({
    count: rows.length,
    rows: rows.map((r) => ({
      id: Number(r.id),
      imageId: r.image_id == null ? null : Number(r.image_id),
      name: r.name,
      imageName: r.image_name,
      chosenNum: r.chosen_num == null ? null : Number(r.chosen_num),
      chosenName: r.chosen_name,
      candidates: r.candidates || [],
      embedding: r.embedding,
    })),
  });
}

/** Record (or clear) one label for an uploaded image. */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const b = await req.json();
    if (!Number.isInteger(b.imageId)) return NextResponse.json({ error: "imageId required" }, { status: 400 });
    const candidates = Array.isArray(b.candidates) ? b.candidates.map(Number).filter(Number.isInteger).slice(0, 20) : [];
    const embedding = typeof b.embedding === "string" ? b.embedding.slice(0, 20000) : null;
    if (b.chosenNum == null) {
      await query("DELETE FROM labels WHERE owner = $1 AND image_id = $2", [owner, b.imageId]);
    } else {
      await query(
        `INSERT INTO labels (owner, image_id, name, chosen_num, chosen_name, candidates, embedding, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (owner, image_id) DO UPDATE SET
           chosen_num = EXCLUDED.chosen_num, chosen_name = EXCLUDED.chosen_name,
           candidates = EXCLUDED.candidates, embedding = EXCLUDED.embedding, updated_at = now()`,
        [owner, b.imageId, typeof b.name === "string" ? b.name.slice(0, 200) : null, b.chosenNum, typeof b.chosenName === "string" ? b.chosenName.slice(0, 200) : null, candidates, embedding],
      );
    }
    const { rows } = await query("SELECT count(*)::int AS n FROM labels WHERE owner = $1 AND chosen_num IS NOT NULL", [owner]);
    return NextResponse.json({ ok: true, count: rows[0].n });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
