"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Room = { id: string; name: string; created_by: string; task_count: number };
type TaskType = "code" | "doc" | "image" | "shell";
type Task = { id: string; room_id: string; title: string; type: TaskType; status: string; created_by: string; updated_at: string };
type Message = { id: number; author: string; kind: string; body: string; created_at: string };
type Artifact = { id: number; type: string; title: string | null; content: string; version: number; created_by: string; created_at: string };
type Proposal = { id: number; assistant_of: string; action: string; args: Record<string, string>; rationale: string | null; status: string };
type TaskData = { task: Task; room: Room | null; messages: Message[]; artifact: Artifact | null; proposals: Proposal[] };
type Run = { id: number; pipeline_id: string; status: string; trigger: string; started_at: string; latency_ms: number | null; model_calls: number; output: string | null; error: string | null; steps: { cmd: string; model?: string; ms: number }[] };

const HELP: [string, string][] = [
  ["/agent ", "ask the working agent to produce or change the artifact"],
  ["/approve", "approve your assistant's pending proposal"],
  ["/pull ", "pull another task's context into this one"],
  ["/status completed", "mark the task completed"],
  ["/status in_progress", "mark the task in progress"],
  ["/run", "shell tasks: run the pipeline now, keep it scheduled"],
];
const ago = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
const colorFor = (a: string) => { let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 70% 70%)`; };
const statusBadge = (s: string) => s === "completed" ? "bg-emerald-900/50 text-emerald-300" : s === "in_progress" ? "bg-amber-900/50 text-amber-200" : "bg-zinc-800 text-zinc-300";

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

function Doc({ md }: { md: string }) {
  return (
    <div className="space-y-2 text-zinc-200 leading-relaxed">
      {md.split("\n").map((line, i) => {
        if (/^#\s/.test(line)) return <h1 key={i} className="text-xl font-semibold text-zinc-50 mt-2">{line.replace(/^#\s/, "")}</h1>;
        if (/^##\s/.test(line)) return <h2 key={i} className="text-lg font-semibold text-zinc-100 mt-3">{line.replace(/^##\s/, "")}</h2>;
        if (/^###\s/.test(line)) return <h3 key={i} className="font-semibold text-zinc-100 mt-2">{line.replace(/^###\s/, "")}</h3>;
        if (/^\s*[-*]\s/.test(line)) return <div key={i} className="pl-4">• {line.replace(/^\s*[-*]\s/, "")}</div>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function Viewer({ data, runs }: { data: TaskData; runs: Run[] }) {
  const a = data.artifact; const t = data.task.type;
  if (!a) return <div className="text-zinc-500 p-6">No artifact yet. Ask the agent: <span className="text-zinc-300">/agent</span> describe what to {t === "code" ? "build" : t === "image" ? "draw" : t === "shell" ? "watch" : "write"}.</div>;
  if (t === "image") return a.content.trim().startsWith("<svg") ? <div className="p-4 [&_svg]:w-full [&_svg]:h-auto [&_svg]:rounded" dangerouslySetInnerHTML={{ __html: a.content }} /> : <img src={a.content.trim()} alt={a.title ?? ""} className="max-w-full rounded" />;
  if (t === "doc") return <div className="p-5 max-w-3xl"><Doc md={a.content} /></div>;
  if (t === "shell") return (
    <div className="p-4 space-y-3">
      <div><div className="text-zinc-500 text-xs mb-1">pipeline (scheduled every 10m once run)</div><pre className="whitespace-pre-wrap break-words text-amber-200/90 bg-zinc-950 rounded p-3 font-mono text-[12px]">{a.content.split("|").map((s, i) => (i ? "  | " : "") + s.trim()).join("\n")}</pre></div>
      <div className="text-zinc-500 text-xs">runs</div>
      {runs.length === 0 && <div className="text-zinc-500 text-sm">no runs yet: type /run</div>}
      {runs.map((r) => (
        <div key={r.id} className="rounded border border-zinc-800 p-3 font-mono text-[12px]">
          <div className="text-zinc-400">#{r.id} · <span className={r.status === "ok" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : "text-zinc-400"}>{r.status}</span> · {r.trigger} · {ago(r.started_at)} ago · {r.latency_ms ?? "…"}ms · {r.steps.map((s) => s.cmd + (s.model ? ` (${s.model})` : "")).join(" | ")}</div>
          {r.output && <pre className="mt-2 whitespace-pre-wrap break-words text-zinc-200 max-h-60 overflow-auto">{r.output}</pre>}
          {r.error && <div className="text-red-400 mt-1">{r.error}</div>}
        </div>
      ))}
      <a className="text-zinc-500 underline text-xs" href="/shell" target="_blank" rel="noreferrer">open the full shell view</a>
    </div>
  );
  return <pre className="p-4 whitespace-pre-wrap break-words font-mono text-[12.5px] text-zinc-100 leading-relaxed">{a.content}</pre>;
}

export default function Home() {
  const [user, setUser] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [data, setData] = useState<TaskData | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newType, setNewType] = useState<TaskType>("doc");
  const [assist, setAssist] = useState("your assistant joins when you open a task");
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { const u = localStorage.getItem("cash:user"); if (u) setUser(u); } catch {} }, []);
  const loadRooms = useCallback(async () => { try { setRooms((await api<{ rooms: Room[] }>("/api/rooms")).rooms); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  const loadTasks = useCallback(async (rid: string) => { try { setTasks((await api<{ tasks: Task[] }>(`/api/rooms/${rid}/tasks`)).tasks); } catch {} }, []);
  const loadTask = useCallback(async (tid: string) => {
    try {
      const d = await api<TaskData>(`/api/tasks/${tid}`); setData(d);
      if (d.task.type === "shell") { const s = await api<{ runs: Run[] }>("/api/state"); setRuns(s.runs.filter((r) => r.pipeline_id === tid).slice(0, 5)); }
    } catch {}
  }, []);

  useEffect(() => { if (!user) return; loadRooms(); const t = setInterval(loadRooms, 10000); return () => clearInterval(t); }, [user, loadRooms]);
  useEffect(() => { if (!roomId) return; loadTasks(roomId); const t = setInterval(() => loadTasks(roomId), 5000); return () => clearInterval(t); }, [roomId, loadTasks]);
  useEffect(() => { if (!taskId) return; loadTask(taskId); const t = setInterval(() => loadTask(taskId), 3000); return () => clearInterval(t); }, [taskId, loadTask]);
  // Background assistant: while you are in a task, your assistant reads the room every 40s and proposes; it never acts without approval.
  useEffect(() => {
    if (!taskId || !user) return;
    const tick = async () => { try { setAssist("reading…"); const r = await api<{ idle: boolean }>(`/api/tasks/${taskId}/assistant`, { username: user }); setAssist(r.idle ? "nothing new since last read" : "posted an update"); loadTask(taskId); } catch (e) { setAssist(`error: ${e instanceof Error ? e.message : e}`); } };
    const first = setTimeout(tick, 4000); const t = setInterval(tick, 40000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [taskId, user, loadTask]);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [data?.messages.length]);

  const login = async (e: React.FormEvent) => { e.preventDefault(); try { const r = await api<{ username: string }>("/api/login", { username: nameInput }); localStorage.setItem("cash:user", r.username); setUser(r.username); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const send = async (body: string) => {
    if (!taskId || !user || !body.trim()) return;
    setBusy(true); setErr(null);
    try { setData(await api<TaskData>(`/api/tasks/${taskId}/messages`, { username: user, body })); setText(""); if (body.startsWith("/status")) loadTasks(roomId!); if (data?.task.type === "shell") loadTask(taskId); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false); inputRef.current?.focus();
  };
  const decide = async (id: number, decision: "approve" | "decline") => { if (!taskId || !user) return; setBusy(true); try { await api(`/api/proposals/${id}`, { username: user, decision }); await loadTask(taskId); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); };
  const mkRoom = async (e: React.FormEvent) => { e.preventDefault(); if (!newRoom.trim()) return; try { const r = await api<{ id: string }>("/api/rooms", { name: newRoom, username: user }); setNewRoom(""); await loadRooms(); setRoomId(r.id); setTaskId(null); setData(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const mkTask = async (e: React.FormEvent) => { e.preventDefault(); if (!newTask.trim() || !roomId) return; try { const r = await api<{ id: string }>("/api/tasks", { roomId, title: newTask, type: newType, username: user }); setNewTask(""); await loadTasks(roomId); setTaskId(r.id); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };

  const header = (
    <header className="border-b border-zinc-800 px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-zinc-500 text-sm">Xyne presents</span>
      <img src="/xyne.svg" alt="Xyne" className="h-4 opacity-90" />
      <h1 className="text-zinc-50 text-lg font-semibold tracking-tight">CASH</h1>
      <span className="text-zinc-400">Collaborative Agent Shell</span>
      <span className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
        {user && <span>signed in as <span className="text-zinc-200">{user}</span> · <button className="underline" onClick={() => { localStorage.removeItem("cash:user"); setUser(null); setTaskId(null); setData(null); }}>switch</button></span>}
        <a className="underline decoration-zinc-700 hover:text-zinc-300" href="https://github.com/juspay/xyne-spaces" target="_blank" rel="noreferrer">Xyne, the open-source org OS</a>
      </span>
    </header>
  );

  if (!user) return (
    <main className="min-h-screen bg-zinc-950 text-zinc-200">{header}
      <div className="max-w-md mx-auto mt-24 rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <h2 className="text-xl font-semibold text-zinc-50">Join the shell</h2>
        <p className="text-zinc-400 mt-2">Pick a username. Everyone in a room sees the same tasks, the same conversation and the same agent work, live. Your background assistant reads along and asks before it acts.</p>
        <form onSubmit={login} className="mt-6 flex gap-2">
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="username" className="flex-1 rounded bg-zinc-950 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400" autoFocus />
          <button className="rounded bg-zinc-100 text-zinc-900 px-4 py-2 font-medium">Enter</button>
        </form>
        {err && <div className="text-red-400 mt-3 text-sm">{err}</div>}
      </div>
    </main>
  );

  const pending = data?.proposals ?? [];
  return (
    <main className="h-screen flex flex-col bg-zinc-950 text-zinc-200">{header}
      {err && <div className="px-5 py-1.5 text-red-300 bg-red-950/40 border-b border-red-900/40 text-sm">{err}</div>}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] divide-x divide-zinc-800">
        {/* LEFT: collaboration */}
        <section className="min-h-0 flex flex-col">
          <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap gap-2 items-center text-sm">
            <button className={`hover:text-zinc-50 ${!roomId ? "text-zinc-50" : "text-zinc-400"}`} onClick={() => { setRoomId(null); setTaskId(null); setData(null); }}>rooms</button>
            {roomId && <><span className="text-zinc-600">›</span><button className={`hover:text-zinc-50 ${!taskId ? "text-zinc-50" : "text-zinc-400"}`} onClick={() => { setTaskId(null); setData(null); }}>{rooms.find((r) => r.id === roomId)?.name ?? roomId}</button></>}
            {taskId && data && <><span className="text-zinc-600">›</span><span className="text-zinc-50">{data.task.title}</span><span className={`px-1.5 py-0.5 rounded text-xs ${statusBadge(data.task.status)}`}>{data.task.status}</span><span className="text-xs text-zinc-500">{data.task.type}</span></>}
          </div>
          {!roomId && (
            <div className="p-4 space-y-3 overflow-auto">
              <div className="text-zinc-500 text-sm">Rooms are shared spaces. Pick one or create one.</div>
              {rooms.map((r) => (
                <button key={r.id} onClick={() => { setRoomId(r.id); setTaskId(null); setData(null); }} className="w-full text-left rounded-lg border border-zinc-800 hover:border-zinc-600 p-3">
                  <div className="text-zinc-50">{r.name}</div><div className="text-xs text-zinc-500">{r.task_count} tasks · by {r.created_by}</div>
                </button>
              ))}
              <form onSubmit={mkRoom} className="flex gap-2"><input value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="new room name" className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400" /><button className="rounded bg-zinc-100 text-zinc-900 px-3 py-2">Create room</button></form>
            </div>
          )}
          {roomId && !taskId && (
            <div className="p-4 space-y-3 overflow-auto">
              <div className="text-zinc-500 text-sm">Tasks in this room. Each has a type that decides what the agent builds on the right.</div>
              {tasks.map((t) => (
                <button key={t.id} onClick={() => setTaskId(t.id)} className="w-full text-left rounded-lg border border-zinc-800 hover:border-zinc-600 p-3 flex items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-zinc-500 w-12">{t.type}</span>
                  <span className="text-zinc-50 flex-1">{t.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${statusBadge(t.status)}`}>{t.status}</span>
                  <span className="text-xs text-zinc-600">{ago(t.updated_at)}</span>
                </button>
              ))}
              <form onSubmit={mkTask} className="flex gap-2">
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="new task title" className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400" />
                <select value={newType} onChange={(e) => setNewType(e.target.value as TaskType)} className="rounded bg-zinc-900 border border-zinc-700 px-2 py-2">{["doc", "code", "image", "shell"].map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <button className="rounded bg-zinc-100 text-zinc-900 px-3 py-2">Create</button>
              </form>
            </div>
          )}
          {taskId && data && (
            <>
              <div ref={streamRef} className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
                {data.messages.map((m) => {
                  const isAgent = m.kind === "agent"; const isSys = m.kind === "system" || m.kind === "context"; const isCmd = m.kind === "command";
                  return (
                    <div key={m.id} className={`rounded-lg px-3 py-2 ${isAgent ? "bg-indigo-950/40 border border-indigo-900/50" : isSys ? "bg-zinc-900/60 border border-zinc-800" : "bg-zinc-900"}`}>
                      <div className="text-xs mb-1 flex gap-2"><span style={{ color: colorFor(m.author) }}>{m.author}</span><span className="text-zinc-600">{m.kind !== "message" ? m.kind + " · " : ""}{ago(m.created_at)} ago</span></div>
                      <div className={`whitespace-pre-wrap break-words ${isCmd ? "font-mono text-amber-200/90" : "text-zinc-200"} text-[13.5px] leading-relaxed`}>{m.body}</div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-zinc-800 p-3 space-y-2">
                {help && (
                  <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs space-y-1">
                    <div className="flex flex-wrap gap-1.5">{HELP.map(([c, d]) => <button key={c} title={d} onClick={() => { if (c.endsWith(" ")) { setText(c); inputRef.current?.focus(); } else send(c); }} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 font-mono text-amber-200/90">{c.trim()}</button>)}</div>
                    <div className="flex flex-wrap gap-1.5 items-center"><span className="text-zinc-500">pull context from:</span>{tasks.filter((t) => t.id !== taskId).map((t) => <button key={t.id} onClick={() => send(`/pull ${t.id}`)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">{t.title}</button>)}</div>
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2">
                  <button type="button" onClick={() => setHelp(!help)} className="rounded border border-zinc-700 px-2 text-zinc-400 hover:text-zinc-100">?</button>
                  <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={busy ? "working…" : "message the room, or /agent, /approve, /pull, /status, /run (? for help)"} className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400 disabled:opacity-60" autoFocus />
                  <button disabled={busy} className="rounded bg-zinc-100 text-zinc-900 px-3 py-2 disabled:opacity-50">Send</button>
                </form>
                <div className="text-xs text-zinc-500">assistant:{user} · {assist}</div>
              </div>
            </>
          )}
        </section>
        {/* RIGHT: the agent's work */}
        <section className="min-h-0 flex flex-col bg-zinc-950">
          <div className="px-4 py-2 border-b border-zinc-800 text-sm flex items-center gap-3">
            <span className="text-zinc-400">agent workspace</span>
            {data?.artifact && <span className="text-zinc-500">· {data.task.type} · v{data.artifact.version} · by {data.artifact.created_by} · {ago(data.artifact.created_at)} ago</span>}
            {data && !data.artifact && <span className="text-zinc-600">· nothing built yet</span>}
          </div>
          {pending.length > 0 && (
            <div className="border-b border-zinc-800 bg-indigo-950/30 px-4 py-3 space-y-2">
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-indigo-300">assistant:{p.assistant_of} proposes #{p.id}</span>
                  <span className="text-zinc-200">{p.action}{p.args.instruction ? `: ${p.args.instruction}` : p.args.status ? `: ${p.args.status}` : ""}</span>
                  {p.rationale && <span className="text-zinc-500">— {p.rationale}</span>}
                  <span className="ml-auto flex gap-2"><button disabled={busy} onClick={() => decide(p.id, "approve")} className="rounded bg-emerald-500/90 text-zinc-950 px-3 py-1 font-medium disabled:opacity-50">Approve</button><button disabled={busy} onClick={() => decide(p.id, "decline")} className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-50">Decline</button></span>
                </div>
              ))}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto">
            {!data ? <div className="p-6 text-zinc-500">Open a task to see the agent working here. The viewer adapts to the task type: code, document, image or shell pipeline.</div> : <Viewer data={data} runs={runs} />}
          </div>
        </section>
      </div>
    </main>
  );
}
