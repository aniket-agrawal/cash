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
  "create table if not exists private_messages (id bigserial primary key, task_id text references tasks(id) on delete cascade, username text not null, author text not null, body text not null, created_at timestamptz not null default now())",
  "create index if not exists messages_task on messages(task_id, id)",
  "create index if not exists artifacts_task on artifacts(task_id, id desc)",
  "create index if not exists private_task_user on private_messages(task_id, username, id)",
];

export type TaskType = "code" | "doc" | "image" | "shell";
export const TASK_TYPES: TaskType[] = ["code", "doc", "image", "shell"];
export const STATUSES = ["open", "in_progress", "completed"] as const;
export const TASK_AGENT = "task agent";

export interface Task { id: string; room_id: string; title: string; type: TaskType; status: string; created_by: string; created_at: string; updated_at: string }
export interface Message { id: number; task_id: string; author: string; kind: string; body: string; created_at: string }
export interface Artifact { id: number; task_id: string; type: string; title: string | null; content: string; version: number; created_by: string; created_at: string }
export interface Proposal { id: number; task_id: string; assistant_of: string; action: string; args: Record<string, string>; rationale: string | null; status: string; created_at: string }
export interface PrivateMessage { id: number; task_id: string; username: string; author: string; body: string; created_at: string }

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `t${Date.now().toString(36)}`;
const clean = (u: string) => String(u ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 32);
const parseJson = <T,>(text: string, fallback: T): T => { try { return JSON.parse(text.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim()) as T; } catch { return fallback; } };

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
  await postMessage(id, "system", "system", `${by} opened this ${type} task. Say what you want here; the task agent builds it on the right and everyone can steer.`);
  return id;
}
export async function postMessage(taskId: string, author: string, kind: string, body: string) {
  await q("insert into messages (task_id, author, kind, body) values ($1,$2,$3,$4)", [taskId, author, kind, body.slice(0, 8000)]);
  await q("update tasks set updated_at = now() where id = $1", [taskId]);
}
export async function getTask(taskId: string) {
  const [task] = await q<Task>("select * from tasks where id = $1", [taskId]);
  if (!task) return null;
  const [messages, artifacts, room] = await Promise.all([
    q<Message>("select * from messages where task_id = $1 order by id desc limit 60", [taskId]),
    q<Artifact>("select * from artifacts where task_id = $1 order by id desc limit 1", [taskId]),
    q("select * from rooms where id = $1", [task.room_id]),
  ]);
  const working = ((await kvGet<number>(`lock:task-agent:${taskId}`)) ?? 0) > Date.now() - 90_000;
  return { task, room: room[0] ?? null, messages: messages.reverse(), artifact: artifacts[0] ?? null, working };
}
export async function getPrivate(taskId: string, username: string) {
  const u = clean(username);
  const [messages, proposals] = await Promise.all([
    q<PrivateMessage>("select * from private_messages where task_id = $1 and username = $2 order by id desc limit 40", [taskId, u]),
    q<Proposal>("select * from proposals where task_id = $1 and assistant_of = $2 and status = 'pending' order by id desc", [taskId, u]),
  ]);
  return { messages: messages.reverse(), proposals };
}

const TYPE_PROMPT: Record<TaskType, string> = {
  code: "Produce the complete source code for this task as plain text. No markdown fences, no commentary. Start with a one-line comment naming the file.",
  doc: "Produce the complete document in Markdown: a title, short sections, concrete content. No preamble.",
  image: "Produce a single complete inline SVG illustration for this task: <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 500\" ...>...</svg>. Flat colors, readable text labels, no external references, no markdown.",
  shell: "Produce one CASH pipeline spec on a single line: commands joined by | using only fetch <url>, gh-releases <owner/repo> [-n N], hn \"<query>\" [-n N], arxiv \"<query>\" [-n N], shop \"<query>\" [--max USD] [-n N], grep [-v] <regex>, head -n N, diff, filter \"<criterion>\", llm \"<instruction>\", brief [\"focus\"], notify [\"title\"]. No commentary.",
};
function contextBlock(task: Task, messages: Message[], artifact: Artifact | null) {
  const recent = messages.slice(-30).map((m) => `[${m.author}${m.kind !== "message" ? ` · ${m.kind}` : ""}] ${m.body.slice(0, 500)}`).join("\n");
  const art = artifact ? `\n\nCURRENT ARTIFACT (v${artifact.version}, ${artifact.type}):\n${artifact.content.slice(0, 6000)}` : "\n\nCURRENT ARTIFACT: none yet";
  return `TASK: ${task.title} (type ${task.type}, status ${task.status})\n\nSHARED CONVERSATION (oldest first; people and their assistants steer here):\n${recent}${art}`;
}

// The task agent: builds the artifact for everyone, reports in one line. The work speaks for itself.
export async function generateArtifact(taskId: string, instruction: string, by: string) {
  const data = await getTask(taskId);
  if (!data) throw new Error("no such task");
  const { task, messages, artifact } = data;
  await kvSet(`lock:task-agent:${taskId}`, Date.now());
  try {
    const r = await llm(`${TYPE_PROMPT[task.type] ?? TYPE_PROMPT.doc}\n\nSTEERING (${by}): ${instruction}\n\n${contextBlock(task, messages, artifact)}`, "smart",
      "You are the task agent inside CASH, a collaborative agents shell. Several people steer you through the shared conversation; some messages carry context from their private assistants. Apply the latest steering, keep what was good, and output only the artifact.");
    let content = r.text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
    if (task.type === "image") { const i = content.indexOf("<svg"); const j = content.lastIndexOf("</svg>"); if (i >= 0 && j > i) content = content.slice(i, j + 6); }
    const version = (artifact?.version ?? 0) + 1;
    await q("insert into artifacts (task_id, type, title, content, version, created_by) values ($1,$2,$3,$4,$5,$6)", [taskId, task.type, task.title, content, version, by]);
    const summary = await llm(`One short sentence (max 18 words) saying what changed in this ${task.type} artifact. Plain text, no preamble.\n\nSTEERING: ${instruction.slice(0, 800)}\n\nARTIFACT:\n${content.slice(0, 3000)}`, "cheap").catch(() => ({ text: `updated the ${task.type}` } as { text: string }));
    await postMessage(taskId, TASK_AGENT, "agent", `v${version} · ${summary.text.trim()}`);
    if (task.status === "open") await q("update tasks set status = 'in_progress' where id = $1", [taskId]);
    return { version, model: r.model };
  } finally { await kvSet(`lock:task-agent:${taskId}`, 0); }
}

// Reacts to new steering in the shared space without anyone typing a command.
export async function taskAgentTick(taskId: string) {
  const lockKey = `lock:task-agent:${taskId}`, curKey = `cursor:task-agent:${taskId}`;
  if (((await kvGet<number>(lockKey)) ?? 0) > Date.now() - 90_000) return { busy: true };
  const cursor = (await kvGet<number>(curKey)) ?? 0;
  const fresh = await q<Message>("select * from messages where task_id = $1 and id > $2 and kind = 'message' order by id", [taskId, cursor]);
  const all = await q<{ id: number }>("select max(id) as id from messages where task_id = $1", [taskId]);
  await kvSet(curKey, Number(all[0]?.id ?? cursor));
  if (!fresh.length) return { idle: true };
  const steering = fresh.map((m) => `- [${m.author}] ${m.body.slice(0, 700)}`).join("\n");
  const r = await generateArtifact(taskId, `The room steered you with these new messages; apply them:\n${steering}`, TASK_AGENT);
  return { idle: false, ...r };
}

export async function pullContext(taskId: string, fromTaskId: string, by: string) {
  const src = await getTask(fromTaskId);
  if (!src) throw new Error(`no such task: ${fromTaskId}`);
  const recent = src.messages.slice(-6).map((m) => `  - [${m.author}] ${m.body.slice(0, 160)}`).join("\n");
  const art = src.artifact ? `artifact v${src.artifact.version} (${src.artifact.type}):\n${src.artifact.content.slice(0, 1000)}` : "no artifact yet";
  await postMessage(taskId, by, "command", `/pull ${fromTaskId}`);
  await postMessage(taskId, "system", "context", `Context pulled from "${src.task.title}" (${fromTaskId}, ${src.task.status}):\n${art}\n\nRecent discussion there:\n${recent}`);
}
export async function runShellTask(taskId: string, by: string) {
  const data = await getTask(taskId);
  if (!data) throw new Error("no such task");
  const spec = data.artifact?.content.split("\n").find((l) => l.trim()) ?? "";
  if (!spec) throw new Error("no pipeline yet: say what to watch and the task agent will write one");
  await q("insert into pipelines (id, name, spec, every_minutes) values ($1,$2,$3,10) on conflict (id) do update set spec = excluded.spec, enabled = true", [taskId, data.task.title, spec]);
  const [p] = await q<Pipeline>("select * from pipelines where id = $1", [taskId]);
  const r = await runPipeline(p, "manual");
  const [run] = await q<{ output: string | null; error: string | null }>("select output, error from runs where id = $1", [r.runId]);
  await postMessage(taskId, TASK_AGENT, "agent", r.status === "failed" ? `run #${r.runId} failed: ${run?.error}` : `run #${r.runId} ${r.status} · ${r.ms}ms · ${r.modelCalls} model calls · scheduled every 10 min\n${(run?.output ?? "").slice(0, 900)}`);
  return r;
}

export const HELP = [
  ["/agent <instruction>", "give the task agent an explicit instruction (plain messages steer it too)"],
  ["/pull <task-id>", "pull another task's artifact and discussion into this one"],
  ["/status open|in_progress|completed", "change the task status"],
  ["/run", "shell tasks: run the pipeline now and keep it scheduled"],
  ["/help", "show this list"],
] as const;

export async function handleMessage(taskId: string, username: string, raw: string) {
  const body = raw.trim();
  if (!body) return { react: false };
  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(" ");
  if (!body.startsWith("/")) { await postMessage(taskId, username, "message", body); return { react: true }; }
  switch (cmd) {
    case "/help": await postMessage(taskId, "system", "system", HELP.map(([c, d]) => `${c} — ${d}`).join("\n")); return { react: false };
    case "/status": {
      const s = arg.replace("-", "_");
      if (!(STATUSES as readonly string[]).includes(s)) throw new Error("status must be open, in_progress or completed");
      await q("update tasks set status = $2, updated_at = now() where id = $1", [taskId, s]);
      await postMessage(taskId, "system", "system", `${username} marked this task ${s}.`);
      return { react: false };
    }
    case "/pull": if (!arg) throw new Error("usage: /pull <task-id>"); await pullContext(taskId, arg.trim(), username); return { react: false };
    case "/agent": { if (!arg) throw new Error("usage: /agent <instruction>"); await postMessage(taskId, username, "command", `/agent ${arg}`); await generateArtifact(taskId, arg, username); await kvSet(`cursor:task-agent:${taskId}`, Number((await q<{ id: number }>("select max(id) as id from messages where task_id = $1", [taskId]))[0]?.id ?? 0)); return { react: false }; }
    case "/run": await postMessage(taskId, username, "command", "/run"); await runShellTask(taskId, username); return { react: false };
    case "/approve": case "/decline": {
      const id = Number(arg) || (await q<{ id: number }>("select id from proposals where task_id = $1 and assistant_of = $2 and status = 'pending' order by id desc limit 1", [taskId, clean(username)]))[0]?.id;
      if (!id) throw new Error("no pending proposal");
      await resolveProposal(id, username, cmd === "/approve" ? "approve" : "decline");
      return { react: false };
    }
    default: throw new Error(`${cmd}: unknown command (try /help)`);
  }
}

export async function resolveProposal(id: number, username: string, decision: "approve" | "decline") {
  const u = clean(username);
  const [p] = await q<Proposal>("select * from proposals where id = $1 and status = 'pending'", [id]);
  if (!p) throw new Error("proposal not pending");
  await q("update proposals set status = $2, resolved_at = now() where id = $1", [id, decision === "approve" ? "approved" : "declined"]);
  if (decision === "decline") { await q("insert into private_messages (task_id, username, author, body) values ($1,$2,'assistant',$3)", [p.task_id, u, `Okay, I won't do that (#${id}).`]); return { posted: false }; }
  let note = "";
  if (p.action === "post_message") { await postMessage(p.task_id, u, "message", String(p.args.message ?? "")); note = `Posted to the room as you: "${String(p.args.message ?? "").slice(0, 160)}". The task agent will pick it up.`; }
  else if (p.action === "update_artifact") { await generateArtifact(p.task_id, String(p.args.instruction ?? "improve the artifact"), `${u} (via assistant)`); note = "Done: the task agent applied the change; see the workspace."; }
  else if (p.action === "set_status") { const s = String(p.args.status ?? "in_progress"); await q("update tasks set status = $2, updated_at = now() where id = $1", [p.task_id, s]); await postMessage(p.task_id, "system", "system", `${u} marked this task ${s}.`); note = `Status set to ${s}.`; }
  else if (p.action === "run_shell") { await runShellTask(p.task_id, u); note = "Ran the pipeline; results are in the room."; }
  await q("update proposals set status = 'done' where id = $1", [id]);
  await q("insert into private_messages (task_id, username, author, body) values ($1,$2,'assistant',$3)", [p.task_id, u, note]);
  return { posted: p.action === "post_message" };
}

const ASSISTANT_SYSTEM = "You are a person's private assistant inside CASH, a collaborative agents shell. Only your person sees you. Be brief and summary-first (max 70 words). You never act on the shared task without approval: you propose, they approve. You may propose to post a message to the shared room on their behalf (written in first person as them, carrying the gist of your private discussion so the task agent has full context), to change the artifact directly, or to change status.";
const PROPOSAL_SHAPE = `"proposal": null | {"action":"post_message","message":"<first-person message as the user for the shared room, <= 60 words>","rationale":"<why>"} | {"action":"update_artifact","instruction":"<specific change>","rationale":"<why>"} | {"action":"set_status","status":"completed"|"in_progress","rationale":"<why>"}`;

async function privateHistory(taskId: string, u: string) {
  const rows = await q<PrivateMessage>("select * from private_messages where task_id = $1 and username = $2 order by id desc limit 12", [taskId, u]);
  return rows.reverse().map((m) => `[${m.author === "assistant" ? "assistant" : u}] ${m.body.slice(0, 400)}`).join("\n");
}
async function fileProposal(taskId: string, u: string, pr: { action?: string; message?: string; instruction?: string; status?: string; rationale?: string } | null | undefined) {
  if (!pr?.action) return null;
  const [pending] = await q<{ id: number }>("select id from proposals where task_id = $1 and assistant_of = $2 and status = 'pending' limit 1", [taskId, u]);
  if (pending) return null;
  const args = pr.action === "post_message" ? { message: pr.message ?? "" } : pr.action === "update_artifact" ? { instruction: pr.instruction ?? "" } : pr.action === "set_status" ? { status: pr.status ?? "in_progress" } : {};
  const [row] = await q<{ id: number }>("insert into proposals (task_id, assistant_of, action, args, rationale) values ($1,$2,$3,$4::jsonb,$5) returning id", [taskId, u, pr.action, JSON.stringify(args), pr.rationale ?? null]);
  return Number(row.id);
}

// You talk to your assistant privately; it answers with a summary and may propose to steer the room for you.
export async function talkToAssistant(taskId: string, username: string, text: string) {
  const u = clean(username);
  const data = await getTask(taskId);
  if (!data) throw new Error("no such task");
  await q("insert into private_messages (task_id, username, author, body) values ($1,$2,$3,$4)", [taskId, u, u, text.slice(0, 2000)]);
  const r = await llm(`${contextBlock(data.task, data.messages, data.artifact)}\n\nPRIVATE CONVERSATION WITH ${u} (oldest first):\n${await privateHistory(taskId, u)}\n\n${u} just said: ${text}\n\nReturn ONLY JSON: {"reply":"<your brief reply, summary-first>", ${PROPOSAL_SHAPE}}. Propose only when it clearly helps; if ${u} wants the shared work changed, propose post_message so the room and the task agent see it as coming from ${u}.`, "smart", ASSISTANT_SYSTEM);
  const parsed = parseJson<{ reply?: string; proposal?: Parameters<typeof fileProposal>[2] }>(r.text, { reply: r.text.slice(0, 400), proposal: null });
  const pid = await fileProposal(taskId, u, parsed.proposal);
  await q("insert into private_messages (task_id, username, author, body) values ($1,$2,'assistant',$3)", [taskId, u, (parsed.reply ?? "").trim() + (pid ? `\n\nProposal #${pid}: ${parsed.proposal?.action}${parsed.proposal?.message ? ` — "${parsed.proposal.message}"` : parsed.proposal?.instruction ? ` — ${parsed.proposal.instruction}` : parsed.proposal?.status ? ` — ${parsed.proposal.status}` : ""}. Approve and I'll do it.` : "")]);
  return { model: r.model, proposal: pid };
}

// Background: while you are in a task, your assistant reads what others did and briefs you privately.
export async function assistantTick(taskId: string, username: string) {
  const u = clean(username);
  const key = `cursor:${taskId}:${u}`;
  const cursor = (await kvGet<number>(key)) ?? 0;
  const fresh = await q<Message>("select * from messages where task_id = $1 and id > $2 and author <> $3 order by id", [taskId, cursor, u]);
  const maxId = fresh.length ? Number(fresh[fresh.length - 1].id) : cursor;
  await kvSet(key, maxId);
  const meaningful = fresh.filter((m) => !(m.kind === "system" && cursor === 0));
  if (!meaningful.length) return { idle: true };
  const data = await getTask(taskId);
  if (!data) return { idle: true };
  const r = await llm(`${contextBlock(data.task, data.messages, data.artifact)}\n\nNEW SINCE YOU LAST BRIEFED ${u}:\n${meaningful.map((m) => `[${m.author} · ${m.kind}] ${m.body.slice(0, 500)}`).join("\n")}\n\nPRIVATE CONVERSATION SO FAR:\n${await privateHistory(taskId, u)}\n\nReturn ONLY JSON: {"reply":"<2-3 sentence brief for ${u}: what others did and what it means>", ${PROPOSAL_SHAPE}}. Propose only if it clearly moves the task forward.`, "smart", ASSISTANT_SYSTEM);
  const parsed = parseJson<{ reply?: string; proposal?: Parameters<typeof fileProposal>[2] }>(r.text, { reply: r.text.slice(0, 400), proposal: null });
  const pid = await fileProposal(taskId, u, parsed.proposal);
  await q("insert into private_messages (task_id, username, author, body) values ($1,$2,'assistant',$3)", [taskId, u, (parsed.reply ?? "").trim() + (pid ? `\n\nProposal #${pid}: ${parsed.proposal?.action}${parsed.proposal?.message ? ` — "${parsed.proposal.message}"` : parsed.proposal?.instruction ? ` — ${parsed.proposal.instruction}` : parsed.proposal?.status ? ` — ${parsed.proposal.status}` : ""}. Approve and I'll do it.` : "")]);
  return { idle: false, model: r.model };
}

// Summaries for the rooms view and the room view, cached briefly in Neon.
export async function summarize(scope: "all" | string) {
  const tasks = scope === "all"
    ? await q<Task & { room_name: string }>("select t.*, r.name as room_name from tasks t join rooms r on r.id = t.room_id order by t.updated_at desc limit 20")
    : await q<Task & { room_name: string }>("select t.*, r.name as room_name from tasks t join rooms r on r.id = t.room_id where t.room_id = $1 order by t.updated_at desc limit 20", [scope]);
  const latest = tasks[0]?.updated_at ?? "none";
  const key = `summary:${scope}:${latest}`;
  const cached = await kvGet<string>(key);
  if (cached) return { summary: cached, cached: true };
  const lines: string[] = [];
  for (const t of tasks) {
    const recent = await q<Message>("select author, kind, body from messages where task_id = $1 order by id desc limit 4", [t.id]);
    lines.push(`- ${t.room_name} › ${t.title} [${t.type}, ${t.status}]: ${recent.reverse().map((m) => `${m.author}: ${m.body.slice(0, 120).replace(/\n/g, " ")}`).join(" | ") || "no activity"}`);
  }
  const r = await llm(`${scope === "all" ? "Summarize what is going on across all rooms" : "Summarize what is going on in this room"} for someone who just walked in. Max 110 words. Use ONLY the facts in ACTIVITY below; never invent versions, decisions or people. A task with no activity gets at most "waiting for a first instruction". Format: one bold-free headline line, then 3-5 short bullets each naming the task and what happened or needs a decision. Plain text.\n\nACTIVITY:\n${lines.join("\n") || "nothing yet"}`, "smart").catch(() => ({ text: "No activity yet." } as { text: string }));
  const text = r.text.trim();
  await kvSet(key, text);
  return { summary: text, cached: false };
}
