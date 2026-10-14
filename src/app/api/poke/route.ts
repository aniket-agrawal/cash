import { NextResponse, connection } from "next/server";
import { kvGet, kvSet } from "@/lib/db";
import { duePipelines, runPipeline } from "@/lib/runner";

export const maxDuration = 300;

// Heartbeat: any open dashboard pokes this once a minute. Rate-limited server-side so it is safe without a secret.
export async function POST() {
  await connection();
  try {
    const last = await kvGet<number>("poke:last");
    const now = Date.now();
    if (last && now - last < 55_000) return NextResponse.json({ skipped: true, nextInMs: 55_000 - (now - last) });
    await kvSet("poke:last", now);
    const due = await duePipelines();
    const results = [];
    for (const p of due) results.push({ pipeline: p.id, ...(await runPipeline(p, "cron")) });
    return NextResponse.json({ due: due.length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
