import { NextResponse, after } from "next/server";
import { getTask, handleMessage, taskAgentTick } from "@/lib/collab";
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { username, body } = await req.json();
    if (!username) throw new Error("username required");
    const { react } = await handleMessage(id, String(username), String(body ?? ""));
    if (react) after(async () => { try { await taskAgentTick(id); } catch (e) { console.error("task agent", e); } });
    return NextResponse.json(await getTask(id));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
