import { NextResponse, connection } from "next/server";
import { authorized } from "@/lib/auth";
import { duePipelines, runPipeline } from "@/lib/runner";

export const maxDuration = 300;

// Scheduler entrypoint: Vercel Cron and the GitHub Actions ticker both hit this.
export async function GET(req: Request) {
  await connection();
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await duePipelines();
  const results = [];
  for (const p of due) results.push({ pipeline: p.id, ...(await runPipeline(p, "cron")) });
  return NextResponse.json({ tick: new Date().toISOString(), due: due.length, results });
}
