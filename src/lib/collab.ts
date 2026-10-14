import { q, kvGet, kvSet } from "./db";
import { llm } from "./llm";
import { runPipeline, type Pipeline } from "./runner";

export const COLLAB_SCHEMA = [
  "create table if not exists users (username text primary key, created_at timestamptz not null default now())",
  "create table if not exists rooms (id text primary key, name text not null, created_by text, created_at timestamptz not null default now())",
  "create table if not exists tasks (id text primary key, room_id text references rooms(id) on delete cascade, title text not null, type text not null default 'doc', status text not null default 'open', created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
  "create table if not exists messages (id bigserial primary key, task_id text references tasks(id) on delete cascade, author text not null, kind text not null default 'message', body text not null, created_at timestamptz not null default now())",
  "create table if not exists artifacts (id bigserial primary key, task_id text references tasks(id) on delete cascade, type text not null, title text, content text not null, version int not null default 1, created_by text, created_at timestamptz not null default now())",
  "create table if not exists proposals (id bigserial primary key, task_id text references tasks(id) on delete cascade, assistant_of text not null, action text not null, args jsonb not null default '{}'::jsonb, rationale text, status text not null default 'pending', created_at timestamptz not null default now(), resolved_at timestamptz)",
  "create index if not exists messages_task on messages(task_id, id)",
  "create index if not exists artifacts_task on artifacts(task_id, id desc)",
];

export type TaskType = "code" | "doc" | "image" | "shell";
export const TASK_TYPES: TaskType[] = ["code", "doc", "image", "shell"];
export const STATUSES = ["open", "in_progress", "completed"] as const;

export interface Task { id: string; room_id: string; title: string; type: TaskType; status: string; created_by: string; created_at: string; updated_at: string }
export interface Message { id: number; task_id: string; author: string; kind: string; body: string; created_at: string }
export interface Artifact { id: number; task_id: string; type: string; title: string | null; content: string; version: number; created_by: string; created_at: string }
export interface Proposal { id: number; task_id: string; assistant_of: string; action: string; args: Record<string, string>; rationale: string | null; status: string; created_at: string }

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `t${Date.now().toString(36)}`;
const clean = (u: string) => String(u ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 32);

export async function ensureUser(username: string) {
  const u = clean(username);
  if (!u) throw new Error("username required");
  await q("insert into users (username) values ($1) on conflict do nothing", [u]);
  return u;
}

export async function listRooms() {
  return q("select r.*, (select count(*) from tasks t where t.room_id = r.id)::int as task_count from rooms r order by r.created_at");
}
export async function createRoom(name: string, by: string) {
  const id = slug(name);
  await q("insert into rooms (id, name, created_by) values ($1,$2,$3) on conflict (id) do nothing", [id, name.trim().slice(0, 80), by]);
  return id;
}
export async function listTasks(roomId: string) {
  return q<Task>("select * from tasks where room_id = $1 order by created_at", [roomId]);
}
export async function createTask(roomId: string, title: string, type: TaskType, by: string) {
  const id = slug(title);
  await q("insert into tasks (id, room_id, title, type, created_by) values ($1,$2,$3,$4,$5) on conflict (id) do nothing", [id, roomId, title.trim().slice(0, 120), TASK_TYPES.includes(type) ? type : "doc", by]);
  await postMessage(id, "system", "system", `${by} created this ${type} task. Everyone in the room can read, write and steer here; type /help for commands.`);
  return id;
}

export async function postMessage(taskId: string, author: string, kind: string, body: string) {
  await q("insert into messages (task_id, author, kind, body) values ($1,$2,$3,$4)", [taskId, author, kind, body.slice(0, 8000)]);
  await q("update tasks set updated_at = now() where id = $1", [taskId]);
}

export async function getTask(taskId: string) {
  const [task] = await q<Task>("select * from tasks where id = $1", [taskId]);
  if (!task) return null;
  const [messages, artifacts, proposals, room] = await Promise.all([
    q<Message>("select * from messages where task_id = $1 order by id desc limit 80", [taskId]),
    q<Artifact>("select * from artifacts where task_id = $1 order by id desc limit 1", [taskId]),
    q<Proposal>("select * from proposals where task_id = $1 and status = 'pending' order by id desc", [taskId]),
    q("select * from rooms where id = $1", [task.room_id]),
  ]);
  return { task, room: room[0] ?? null, messages: messages.reverse(), artifact: artifacts[0] ?? null, proposals };
}

const TYPE_PROMPT: Record<TaskType, string> = {
  code: "Produce the complete source code for this task as plain text. No markdown fences, no commentary. Start with a one-line comment naming the file.",
  doc: "Produce the complete document in Markdown: a title, short sections, concrete content. No preamble.",
  image: "Produce a single complete inline SVG illustration for this task: <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 500\" ...>...</svg>. Flat colors, readable text labels, no external references, no markdown.",
  shell: "Produce one CASH pipeline spec on a single line: commands joined by | using only fetch <url>, gh-releases <owner/repo> [-n N], hn \"<query>\" [-n N], arxiv \"<query>\" [-n N], shop \"<query>\" [--max USD] [-n N], grep [-v] <regex>, head -n N, diff, filter \"<criterion>\", llm \"<instruction>\", brief [\"focus\"], notify [\"title\"]. No commentary.",
};

function contextBlock(task: Task, messages: Message[], artifact: Artifact | null) {
  const recent = messages.slice(-30).map((m) => `[${m.author}${m.kind !== "message" ? ` · ${m.kind}` : ""}] ${m.body.slice(0, 600)}`).join("\n");
  const art = artifact ? `\n\nCURRENT ARTIFACT (v${artifact.version}, ${artifact.type}):\n${artifact.content.slice(0, 6000)}` : "\n\nCURRENT ARTIFACT: none yet";
  return `TASK: ${task.title} (type ${task.type}, status ${task.status})\n\nCONVERSATION (oldest first; humans and assistants steer here):\n${recent}${art}`;
}

export async function generateArtifact(taskId: string, instruction: string, by: string) {
  const data = await getTask(taskId);
  if (!data) throw new Error("no such task");
  const { task, messages, artifact } = data;
  const r = await llm(`${TYPE_PROMPT[task.type] ?? TYPE_PROMPT.doc}\n\nINSTRUCTION FROM ${by}: ${instruction}\n\n${contextBlock(task, messages, artifact)}`, "smart",
    "You are the working agent inside CASH, a collaborative agent shell. Several people steer you through the conversation. Follow the latest instruction, honor operator notes, keep what was good in the current artifact, and output only the artifact.");
  let content = r.text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  if (task.type === "image") { const i = content.indexOf("<svg"); const j = content.lastIndexOf("</svg>"); if (i >= 0 && j > i) content = content.slice(i, j + 6); }
  const version = (artifact?.version ?? 0) + 1;
  await q("insert into artifacts (task_id, type, title, content, version, created_by) values ($1,$2,$3,$4,$5,$6)", [taskId, task.type, task.title, content, version, by]);
  const summary = await llm(`In one sentence (max 25 words), say what changed or what this ${task.type} artifact now contains. Plain text.\n\nINSTRUCTION: ${instruction}\n\nARTIFACT:\n${content.slice(0, 3000)}`, "cheap").catch(() => ({ text: `updated ${task.type} artifact` } as { text: string }));
  await postMessage(taskId, `agent (${r.model})`, "agent", `v${version}: ${summary.text.trim()}`);
  if (task.status === "open") await q("update tasks set status = 'in_progress' where id = $1", [taskId]);
  return { version, model: r.model };
}

export async function pullContext(taskId: string, fromTaskId: string, by: string) {
  const src = await getTask(fromTaskId);
  if (!src) throw new Error(`no such task: ${fromTaskId}`);
  const recent = src.messages.slice(-8).map((m) => `  - [${m.author}] ${m.body.slice(0, 200)}`).join("\n");
  const art = src.artifact ? `artifact v${src.artifact.version} (${src.artifact.type}):\n${src.artifact.content.slice(0, 1200)}` : "no artifact yet";
  await postMessage(taskId, by, "command", `/pull ${fromTaskId}`);
  await postMessage(taskId, "system", "context", `Context pulled from "${src.task.title}" (${fromTaskId}, status ${src.task.status}):\n${art}\n\nRecent discussion there:\n${recent}`);
}

export async function runShellTask(taskId: string, by: string) {
  const data = await getTask(taskId);
  if (!data) throw new Error("no such task");
  const spec = data.artifact?.content.split("\n").find((l) => l.trim()) ?? "";
  if (!spec) throw new Error("no pipeline yet: ask the agent with /agent <what to watch>");
  await q("insert into pipelines (id, name, spec, every_minutes) values ($1,$2,$3,10) on conflict (id) do update set spec = excluded.spec, enabled = true", [taskId, data.task.title, spec]);
  const [p] = await q<Pipeline>("select * from pipelines where id = $1", [taskId]);
  const r = await runPipeline(p, "manual");
  const [run] = await q<{ output: string | null; error: string | null }>("select output, error from runs where id = $1", [r.runId]);
  await postMessage(taskId, "agent (cash)", "agent", r.status === "failed" ? `run #${r.runId} failed: ${run?.error}` : `run #${r.runId} ${r.status} in ${r.ms}ms, ${r.modelCalls} model calls. Scheduled every 10 minutes from now.\n\n${(run?.output ?? "").slice(0, 1500)}`);
  return r;
}

export const HELP = [
  ["/agent <instruction>", "ask the working agent to produce or change the artifact now"],
  ["/approve [id]", "approve your assistant's pending proposal (reads need no approval, actions do)"],
  ["/decline [id]", "decline a proposal"],
  ["/pull <task-id>", "pull another task's artifact and discussion into this one (unified context)"],
  ["/status open|in_progress|completed", "change the task status"],
  ["/run", "shell tasks: run the pipeline now and keep it scheduled"],
  ["/help", "show this list"],
] as const;

export async function handleMessage(taskId: string, username: string, raw: string) {
  const body = raw.trim();
  if (!body) return;
  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(" ");
  if (!body.startsWith("/")) { await postMessage(taskId, username, "message", body); return; }
  switch (cmd) {
    case "/help": await postMessage(taskId, "system", "system", HELP.map(([c, d]) => `${c} — ${d}`).join("\n")); return;
    case "/status": {
      const s = arg.replace("-", "_");
      if (!(STATUSES as readonly string[]).includes(s)) throw new Error("status must be open, in_progress or completed");
      await q("update tasks set status = $2, updated_at = now() where id = $1", [taskId, s]);
      await postMessage(taskId, username, "command", `/status ${s}`);
      await postMessage(taskId, "system", "system", `${username} marked this task ${s}.`);
      return;
    }
    case "/pull": if (!arg) throw new Error("usage: /pull <task-id>"); await pullContext(taskId, arg.trim(), username); return;
    case "/agent": {
      if (!arg) throw new Error("usage: /agent <instruction>");
      await postMessage(taskId, username, "command", `/agent ${arg}`);
      await generateArtifact(taskId, arg, username);
      return;
    }
    case "/run": await postMessage(taskId, username, "command", "/run"); await runShellTask(taskId, username); return;
    case "/approve": case "/decline": {
      const id = Number(arg) || (await q<{ id: number }>("select id from proposals where task_id = $1 and status = 'pending' order by id desc limit 1", [taskId]))[0]?.id;
      if (!id) throw new Error("no pending proposal");
      await resolveProposal(id, username, cmd === "/approve" ? "approve" : "decline");
      return;
    }
    default: throw new Error(`${cmd}: unknown command (try /help)`);
  }
}

export async function resolveProposal(id: number, username: string, decision: "approve" | "decline") {
  const [p] = await q<Proposal>("select * from proposals where id = $1 and status = 'pending'", [id]);
  if (!p) throw new Error("proposal not pending");
  await q("update proposals set status = $2, resolved_at = now() where id = $1", [id, decision === "approve" ? "approved" : "declined"]);
  await postMessage(p.task_id, username, "command", `/${decision} ${id}`);
  if (decision === "decline") { await postMessage(p.task_id, "system", "system", `${username} declined proposal #${id}.`); return; }
  if (p.action === "update_artifact") await generateArtifact(p.task_id, String(p.args.instruction ?? p.rationale ?? "improve the artifact"), `assistant:${p.assistant_of}`);
  else if (p.action === "set_status") { const s = String(p.args.status ?? "in_progress"); await q("update tasks set status = $2, updated_at = now() where id = $1", [p.task_id, s]); await postMessage(p.task_id, "system", "system", `Status set to ${s} by ${username}'s assistant (approved).`); }
  else if (p.action === "run_shell") await runShellTask(p.task_id, `assistant:${p.assistant_of}`);
  await q("update proposals set status = 'done' where id = $1", [id]);
}

// Background assistant: one per (task, user). Reads what others did since last time, posts its understanding,
// and proposes at most one action at a time. Reading needs no permission; acting does.
export async function assistantTick(taskId: string, username: string) {
  const u = clean(username);
  const key = `cursor:${taskId}:${u}`;
  const cursor = (await kvGet<number>(key)) ?? 0;
  const fresh = await q<Message>("select * from messages where task_id = $1 and id > $2 and author <> $3 order by id", [taskId, cursor, `assistant:${u}`]);
  const maxId = fresh.length ? Number(fresh[fresh.length - 1].id) : cursor;
  if (!fresh.length || fresh.every((m) => m.kind === "system" && m.author === "system" && cursor === 0 && fresh.length === 1)) { await kvSet(key, maxId); return { idle: true }; }
  const [pending] = await q<Proposal>("select id from proposals where task_id = $1 and assistant_of = $2 and status = 'pending' limit 1", [taskId, u]);
  const data = await getTask(taskId);
  if (!data) return { idle: true };
  const r = await llm(
    `You are ${u}'s background assistant inside a shared task. New activity since you last looked:\n${fresh.map((m) => `[${m.author} · ${m.kind}] ${m.body.slice(0, 500)}`).join("\n")}\n\n${contextBlock(data.task, data.messages, data.artifact)}\n\nReturn ONLY JSON: {"understanding": "2-3 sentences for ${u}: what others did/decided and what it means for the task", "proposal": null | {"action": "update_artifact", "instruction": "<specific change to make>", "rationale": "<why>"} | {"action": "set_status", "status": "completed" | "in_progress", "rationale": "<why>"} | {"action": "run_shell", "rationale": "<why>"}}. ${pending ? "A proposal of yours is still pending, so set proposal to null." : "Propose an action only if it clearly moves the task forward; otherwise null."}${data.task.type !== "shell" ? ' Never use "run_shell" here.' : ""}`,
    "smart", "You are a careful, concise assistant. You never act without approval; you only read, summarize and propose.");
  await kvSet(key, maxId);
  let parsed: { understanding?: string; proposal?: { action?: string; instruction?: string; status?: string; rationale?: string } | null } = {};
  try { parsed = JSON.parse(r.text.replace(/^```json\n?/i, "").replace(/\n?```$/, "").trim()); } catch { parsed = { understanding: r.text.slice(0, 600), proposal: null }; }
  let body = parsed.understanding?.trim() || "Read the latest activity; nothing to add.";
  if (parsed.proposal && parsed.proposal.action && !pending) {
    const pr = parsed.proposal;
    const args = pr.action === "update_artifact" ? { instruction: pr.instruction ?? "" } : pr.action === "set_status" ? { status: pr.status ?? "in_progress" } : {};
    const [row] = await q<{ id: number }>("insert into proposals (task_id, assistant_of, action, args, rationale) values ($1,$2,$3,$4::jsonb,$5) returning id", [taskId, u, pr.action, JSON.stringify(args), pr.rationale ?? null]);
    body += `\n\nProposal #${row.id} (${pr.action}${pr.instruction ? `: ${pr.instruction}` : pr.status ? `: ${pr.status}` : ""}). Why: ${pr.rationale ?? "moves the task forward"}. Approve to let me run it.`;
  }
  await postMessage(taskId, `assistant:${u}`, "agent", body);
  return { idle: false, model: r.model };
}
