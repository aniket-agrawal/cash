import { NextResponse } from "next/server";
import { getTask } from "@/lib/collab";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getTask(id);
  if (!data) return NextResponse.json({ error: "no such task" }, { status: 404 });
  return NextResponse.json(data);
}
