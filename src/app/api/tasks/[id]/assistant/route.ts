import { NextResponse } from "next/server";
import { assistantTick } from "@/lib/collab";
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { const { username } = await req.json(); if (!username) throw new Error("username required"); return NextResponse.json(await assistantTick(id, String(username))); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
