import { NextResponse } from "next/server";
import { q } from "@/lib/db";
export async function POST(req: Request) {
  const { pipelineId, message } = await req.json();
  if (!pipelineId || !message) return NextResponse.json({ error: "pipelineId and message required" }, { status: 400 });
  await q("insert into steer (pipeline_id, message) values ($1,$2)", [pipelineId, String(message).slice(0, 2000)]);
  return NextResponse.json({ ok: true, note: "applied on the next run" });
}
