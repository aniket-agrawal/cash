import { NextResponse } from "next/server";
import { listTasks } from "@/lib/collab";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ tasks: await listTasks(id) });
}
