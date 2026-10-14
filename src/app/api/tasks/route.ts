import { NextResponse } from "next/server";
import { createTask, type TaskType } from "@/lib/collab";
export async function POST(req: Request) {
  try { const { roomId, title, type, username } = await req.json(); if (!roomId || !title) throw new Error("roomId and title required"); return NextResponse.json({ id: await createTask(roomId, title, (type ?? "doc") as TaskType, username ?? "anon") }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
