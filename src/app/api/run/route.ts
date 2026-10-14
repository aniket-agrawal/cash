import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { runPipeline, type Pipeline } from "@/lib/runner";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { pipelineId } = await req.json();
  const [p] = await q<Pipeline>("select * from pipelines where id = $1", [pipelineId]);
  if (!p) return NextResponse.json({ error: "no such pipeline" }, { status: 404 });
  const r = await runPipeline(p, "manual");
  return NextResponse.json(r);
}
