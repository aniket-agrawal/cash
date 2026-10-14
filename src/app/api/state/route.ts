import { NextResponse, connection } from "next/server";
import { q } from "@/lib/db";
import { helpText } from "@/lib/commands";

export async function GET() {
  await connection();
  const [pipelines, runs, inbox, steer] = await Promise.all([
    q("select id, name, spec, every_minutes, enabled, last_run_at, created_at from pipelines order by created_at"),
    q("select id, pipeline_id, started_at, finished_at, status, trigger, steps, output, error, model_calls, latency_ms from runs order by id desc limit 40"),
    q("select id, pipeline_id, run_id, title, body, created_at from inbox order by id desc limit 20"),
    q("select id, pipeline_id, message, created_at, consumed_at from steer order by id desc limit 20"),
  ]);
  return NextResponse.json({ now: new Date().toISOString(), pipelines, runs, inbox, steer, help: helpText() });
}
