import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorized } from "@/lib/auth";
import { q } from "@/lib/db";
import { COLLAB_SCHEMA, createRoom, createTask, type TaskType } from "@/lib/collab";


const SEEDS: [string, string, number][] = [
  ["next-release-risk", 'gh-releases vercel/next.js -n 5 | diff | brief "breaking changes and migration risk for a team running Next.js in production"', 10],
  ["agent-research", 'hn "ai agents" -n 15 | diff | filter "about building, running, evaluating or securing AI agents" | brief "what matters this hour for teams running agents in production" | notify "research brief"', 10],
  ["keyboard-price-watch", 'shop "low profile mechanical keyboard" --max 150 -n 8 | diff | brief "price drops, new listings and the best value pick; keep product URLs" | notify "shop watch"', 10],
  ["arxiv-agents", 'arxiv "autonomous agents" -n 8 | diff | brief "one-line takeaways with links"', 30],
];

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const schema = await readFile(path.join(process.cwd(), "sql", "schema.sql"), "utf8");
  for (const stmt of schema.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
  for (const [id, spec, every] of SEEDS) {
    await q("insert into pipelines (id, name, spec, every_minutes) values ($1,$1,$2,$3) on conflict (id) do update set spec = excluded.spec, every_minutes = excluded.every_minutes", [id, spec, every]);
  }
  for (const stmt of COLLAB_SCHEMA) await q(stmt);
  const roomId = await createRoom("Fast Forward Hack", "xyne");
  const TASKS: [string, TaskType][] = [["Release risk watch", "shell"], ["CASH launch post", "doc"], ["Rate limiter for the heartbeat endpoint", "code"], ["CASH logo sketch", "image"]];
  for (const [title, type] of TASKS) {
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const exists = await q("select 1 from tasks where id = $1", [id]);
    if (!exists.length) await createTask(roomId, title, type, "xyne");
    if (type === "shell" && !(await q("select 1 from artifacts where task_id = $1", [id])).length)
      await q("insert into artifacts (task_id, type, title, content, version, created_by) values ($1,'shell',$2,$3,1,'xyne')", [id, title, 'gh-releases vercel/next.js -n 5 | diff | brief "breaking changes and migration risk for a team on Next.js"']);
  }
  return NextResponse.json({ ok: true, seeded: SEEDS.map((s) => s[0]), room: roomId, tasks: TASKS.map((t) => t[0]) });
}
