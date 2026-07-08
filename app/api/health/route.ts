import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quick "which commit is live?" probe — handy for confirming a deploy landed. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "moomin-mug-collection",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID || null,
  });
}
