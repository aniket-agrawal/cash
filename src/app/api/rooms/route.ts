import { NextResponse, connection } from "next/server";
import { createRoom, listRooms } from "@/lib/collab";
export async function GET() { await connection(); return NextResponse.json({ rooms: await listRooms() }); }
export async function POST(req: Request) {
  try { const { name, username } = await req.json(); if (!name) throw new Error("name required"); return NextResponse.json({ id: await createRoom(name, username ?? "anon") }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
