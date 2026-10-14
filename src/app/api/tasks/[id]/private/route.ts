import { NextResponse } from "next/server";
import { getPrivate, talkToAssistant } from "@/lib/collab";
export const maxDuration = 300;
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const username = new URL(req.url).searchParams.get("username") ?? "";
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });
  return NextResponse.json(await getPrivate(id, username));
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { const { username, body } = await req.json(); if (!username || !body) throw new Error("username and body required"); await talkToAssistant(id, String(username), String(body)); return NextResponse.json(await getPrivate(id, String(username))); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
