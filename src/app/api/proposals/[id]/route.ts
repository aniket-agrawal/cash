import { NextResponse, after } from "next/server";
import { resolveProposal, taskAgentTick } from "@/lib/collab";
import { q } from "@/lib/db";
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { username, decision } = await req.json();
    const r = await resolveProposal(Number(id), String(username ?? "anon"), decision === "decline" ? "decline" : "approve");
    if (r.posted) { const [p] = await q<{ task_id: string }>("select task_id from proposals where id = $1", [Number(id)]); if (p) after(async () => { try { await taskAgentTick(p.task_id); } catch (e) { console.error("task agent", e); } }); }
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
