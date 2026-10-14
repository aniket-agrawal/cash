import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/collab";
export async function POST(req: Request) {
  try { const { username } = await req.json(); return NextResponse.json({ username: await ensureUser(username) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
