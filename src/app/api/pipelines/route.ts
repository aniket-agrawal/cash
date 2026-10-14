import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { COMMANDS } from "@/lib/commands";
import { splitPipes } from "@/lib/text";

export async function POST(req: Request) {
  const { id, spec, everyMinutes } = await req.json();
  const pid = String(id ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!pid || !spec) return NextResponse.json({ error: "id and spec required" }, { status: 400 });
  for (const stage of splitPipes(spec)) {
    const cmd = stage.split(/\s+/)[0];
    if (!COMMANDS[cmd]) return NextResponse.json({ error: `${cmd}: command not found` }, { status: 400 });
  }
  const every = Math.max(1, Number(everyMinutes ?? 10));
  await q(
    "insert into pipelines (id, name, spec, every_minutes) values ($1,$1,$2,$3) on conflict (id) do update set spec = excluded.spec, every_minutes = excluded.every_minutes, enabled = true",
    [pid, spec, every],
  );
  return NextResponse.json({ ok: true, id: pid, every });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  await q("delete from pipelines where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
