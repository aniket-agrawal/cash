import { NextResponse } from "next/server";
import { q } from "@/lib/db";
export async function POST(req: Request) {
  const { pipelineId, enabled } = await req.json();
  const rows = await q("update pipelines set enabled = $2 where id = $1 returning id, enabled", [pipelineId, !!enabled]);
  if (!rows.length) return NextResponse.json({ error: "no such pipeline" }, { status: 404 });
  return NextResponse.json(rows[0]);
}
