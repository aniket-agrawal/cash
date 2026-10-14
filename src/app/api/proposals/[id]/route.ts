import { NextResponse } from "next/server";
import { resolveProposal } from "@/lib/collab";
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { const { username, decision } = await req.json(); await resolveProposal(Number(id), String(username ?? "anon"), decision === "decline" ? "decline" : "approve"); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
