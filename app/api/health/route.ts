import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quick "which commit is live?" probe — handy for confirming a deploy landed. */
export async function GET() {
  const hasDb = Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING,
  );
  return NextResponse.json({
    ok: true,
    app: "moomin-mug-collection",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    env: { db: hasDb, gemini: Boolean(process.env.GEMINI_API_KEY) },
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID || null,
  });
}
