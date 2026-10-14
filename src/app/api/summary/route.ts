import { NextResponse } from "next/server";
import { summarize } from "@/lib/collab";
export const maxDuration = 120;
export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("room") || "all";
  try { return NextResponse.json(await summarize(scope)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
