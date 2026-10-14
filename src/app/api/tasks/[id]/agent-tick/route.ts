import { NextResponse } from "next/server";
import { taskAgentTick } from "@/lib/collab";
export const maxDuration = 300;
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { return NextResponse.json(await taskAgentTick(id)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
