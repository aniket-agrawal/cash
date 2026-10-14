"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Room = { id: string; name: string; created_by: string; task_count: number };
type TaskType = "code" | "doc" | "image" | "shell";
type Task = { id: string; room_id: string; title: string; type: TaskType; status: string; created_by: string; updated_at: string };
type Message = { id: number; author: string; kind: string; body: string; created_at: string };
type Artifact = { id: number; type: string; title: string | null; content: string; version: number; created_by: string; created_at: string };
type Proposal = { id: number; assistant_of: string; action: string; args: Record<string, string>; rationale: string | null };
type PrivateMsg = { id: number; author: string; body: string; created_at: string };
type TaskData = { task: Task; room: Room | null; messages: Message[]; artifact: Artifact | null; working: boolean };
type PrivateData = { messages: PrivateMsg[]; proposals: Proposal[] };
type Run = { id: number; pipeline_id: string; status: string; trigger: string; started_at: string; latency_ms: number | null; model_calls: number; output: string | null; error: string | null; steps: { cmd: string; model?: string; ms: number }[] };

const ago = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
const colorFor = (a: string) => { let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 65% 72%)`; };
const badge = (s: string) => s === "completed" ? "bg-emerald-500/15 text-emerald-300" : s === "in_progress" ? "bg-amber-500/15 text-amber-200" : "bg-zinc-700/40 text-zinc-300";
async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

function Clamp({ text, mono }: { text: string; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260 || text.split("\n").length > 4;
  return (
    <div>
      <div className={`whitespace-pre-wrap break-words ${mono ? "font-mono text-[12px] text-amber-200/90" : "text-[13px] text-zinc-200"} leading-relaxed ${!open && long ? "max-h-[5.6em] overflow-hidden" : ""}`}>{text}</div>
      {long && <button onClick={() => setOpen(!open)} className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-0.5">{open ? "less" : "more"}</button>}
    </div>
  );
}
function Doc({ md }: { md: string }) {
  return (
    <div className="space-y-2 text-zinc-200 leading-relaxed">
      {md.split("\n").map((line, i) => {
        if (/^#\s/.test(line)) return <h1 key={i} className="text-xl font-semibold text-zinc-50 mt-2">{line.replace(/^#\s/, "")}</h1>;
        if (/^##\s/.test(line)) return <h2 key={i} className="text-lg font-semibold text-zinc-100 mt-3">{line.replace(/^##\s/, "")}</h2>;
        if (/^###\s/.test(line)) return <h3 key={i} className="font-semibold text-zinc-100 mt-2">{line.replace(/^###\s/, "")}</h3>;
        if (/^\s*[-*]\s/.test(line)) return <div key={i} className="pl-4">• {line.replace(/^\s*[-*]\s/, "").replace(/\*\*/g, "")}</div>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{line.replace(/\*\*/g, "")}</p>;
      })}
    </div>
  );
}
function Summary({ title, text, loading }: { title: string; text: string | null; loading: boolean }) {
  const lines = (text ?? "").split("\n").filter((l) => l.trim());
  return (
    <div className="p-6 max-w-3xl">
      <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
      {loading && !text && <div className="text-zinc-500">summarizing what's going on…</div>}
      {lines.length > 0 && <div className="text-lg text-zinc-50 font-medium mb-3">{lines[0].replace(/^[-•]\s*/, "")}</div>}
      <ul className="space-y-2">{lines.slice(1).map((l, i) => <li key={i} className="text-zinc-300 leading-relaxed flex gap-2"><span className="text-zinc-600">•</span><span>{l.replace(/^[-•]\s*/, "")}</span></li>)}</ul>
    </div>
  );
}
function Viewer({ data, runs }: { data: TaskData; runs: Run[] }) {
  const a = data.artifact; const t = data.task.type;
  if (!a) return <div className="text-zinc-500 p-6">Nothing built yet. Say what you want in the collaborative space, or ask your assistant; the task agent builds it here.</div>;
  if (t === "image") return a.content.trim().startsWith("<svg") ? <div className="p-4 [&_svg]:w-full [&_svg]:h-auto [&_svg]:rounded" dangerouslySetInnerHTML={{ __html: a.content }} /> : <img src={a.content.trim()} alt={a.title ?? ""} className="max-w-full rounded" />;
  if (t === "doc") return <div className="p-6 max-w-3xl"><Doc md={a.content} /></div>;
  if (t === "shell") return (
    <div className="p-4 space-y-3">
      <pre className="whitespace-pre-wrap break-words text-amber-200/90 bg-black/40 rounded p-3 font-mono text-[12px]">{a.content.split("|").map((s, i) => (i ? "  | " : "") + s.trim()).join("\n")}</pre>
      <div className="text-xs text-zinc-500">runs (scheduled every 10 min once run)</div>
      {runs.length === 0 && <div className="text-zinc-500 text-sm">no runs yet: type /run in the collaborative space</div>}
      {runs.map((r) => (
        <div key={r.id} className="rounded border border-zinc-800 p-3 font-mono text-[12px]">
          <div className="text-zinc-400">#{r.id} · <span className={r.status === "ok" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : "text-zinc-400"}>{r.status}</span> · {r.trigger} · {ago(r.started_at)} ago · {r.latency_ms ?? "…"}ms · {r.steps.map((s) => s.cmd + (s.model ? ` (${s.model})` : "")).join(" | ")}</div>
          {r.output && <pre className="mt-2 whitespace-pre-wrap break-words text-zinc-200 max-h-56 overflow-auto">{r.output}</pre>}
        </div>
      ))}
    </div>
  );
  return <pre className="p-5 whitespace-pre-wrap break-words font-mono text-[12.5px] text-zinc-100 leading-relaxed">{a.content}</pre>;
}

export default function Home() {
  const [user, setUser] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [data, setData] = useState<TaskData | null>(null);
  const [priv, setPriv] = useState<PrivateData | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [text, setText] = useState("");
  const [ptext, setPtext] = useState("");
  const [busy, setBusy] = useState(false);
  const [pbusy, setPbusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newType, setNewType] = useState<TaskType>("doc");
  const streamRef = useRef<HTMLDivElement>(null);
  const privRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const u = localStorage.getItem("cash:user"); if (u) setUser(u); } catch {} }, []);
  const loadRooms = useCallback(async () => { try { setRooms((await api<{ rooms: Room[] }>("/api/rooms")).rooms); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  const loadTasks = useCallback(async (rid: string) => { try { setTasks((await api<{ tasks: Task[] }>(`/api/rooms/${rid}/tasks`)).tasks); } catch {} }, []);
  const loadTask = useCallback(async (tid: string) => {
    try { const d = await api<TaskData>(`/api/tasks/${tid}`); setData(d); if (d.task.type === "shell") { const s = await api<{ runs: Run[] }>("/api/state"); setRuns(s.runs.filter((r) => r.pipeline_id === tid).slice(0, 5)); } } catch {}
  }, []);
  const loadPriv = useCallback(async (tid: string, u: string) => { try { setPriv(await api<PrivateData>(`/api/tasks/${tid}/private?username=${encodeURIComponent(u)}`)); } catch {} }, []);
  const loadSummary = useCallback(async (scope: string) => { setSumLoading(true); try { setSummary((await api<{ summary: string }>(`/api/summary?room=${scope}`)).summary); } catch {} setSumLoading(false); }, []);

  useEffect(() => { if (!user) return; loadRooms(); const t = setInterval(loadRooms, 10000); return () => clearInterval(t); }, [user, loadRooms]);
  useEffect(() => { if (!user || taskId) return; setSummary(null); loadSummary(roomId ?? "all"); const t = setInterval(() => loadSummary(roomId ?? "all"), 45000); return () => clearInterval(t); }, [user, roomId, taskId, loadSummary]);
  useEffect(() => { if (!roomId) return; loadTasks(roomId); const t = setInterval(() => loadTasks(roomId), 5000); return () => clearInterval(t); }, [roomId, loadTasks]);
  useEffect(() => { if (!taskId || !user) return; setPriv(null); loadTask(taskId); loadPriv(taskId, user); const t = setInterval(() => { loadTask(taskId); loadPriv(taskId, user); }, 3000); return () => clearInterval(t); }, [taskId, user, loadTask, loadPriv]);
  // Your private assistant reads the room every 40s and briefs you; the task agent checks for unapplied steering every 20s.
  useEffect(() => {
    if (!taskId || !user) return;
    const tick = async () => { try { await api(`/api/tasks/${taskId}/assistant`, { username: user }); loadPriv(taskId, user); } catch {} };
    const agent = async () => { try { await api(`/api/tasks/${taskId}/agent-tick`, {}); loadTask(taskId); } catch {} };
    const t1 = setTimeout(tick, 5000); const i1 = setInterval(tick, 40000); const i2 = setInterval(agent, 20000);
    return () => { clearTimeout(t1); clearInterval(i1); clearInterval(i2); };
  }, [taskId, user, loadPriv, loadTask]);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [data?.messages.length]);
  useEffect(() => { privRef.current?.scrollTo({ top: privRef.current.scrollHeight }); }, [priv?.messages.length]);

  const login = async (e: React.FormEvent) => { e.preventDefault(); try { const r = await api<{ username: string }>("/api/login", { username: nameInput }); localStorage.setItem("cash:user", r.username); setUser(r.username); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const send = async (body: string) => {
    if (!taskId || !user || !body.trim()) return; setBusy(true); setErr(null);
    try { setData(await api<TaskData>(`/api/tasks/${taskId}/messages`, { username: user, body })); setText(""); if (body.startsWith("/status")) loadTasks(roomId!); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const talk = async (body: string) => {
    if (!taskId || !user || !body.trim()) return; setPbusy(true); setErr(null);
    try { setPriv(await api<PrivateData>(`/api/tasks/${taskId}/private`, { username: user, body })); setPtext(""); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setPbusy(false);
  };
  const decide = async (id: number, decision: "approve" | "decline") => { if (!taskId || !user) return; setPbusy(true); try { await api(`/api/proposals/${id}`, { username: user, decision }); await loadPriv(taskId, user); await loadTask(taskId); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setPbusy(false); };
  const mkRoom = async (e: React.FormEvent) => { e.preventDefault(); if (!newRoom.trim()) return; try { const r = await api<{ id: string }>("/api/rooms", { name: newRoom, username: user }); setNewRoom(""); await loadRooms(); setRoomId(r.id); setTaskId(null); setData(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const mkTask = async (e: React.FormEvent) => { e.preventDefault(); if (!newTask.trim() || !roomId) return; try { const r = await api<{ id: string }>("/api/tasks", { roomId, title: newTask, type: newType, username: user }); setNewTask(""); await loadTasks(roomId); setTaskId(r.id); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };

  const header = (
    <header className="bg-black border-b border-zinc-800 px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <img src="/xyne.svg" alt="Xyne" className="h-5" />
      <span className="text-zinc-400 text-sm">presents</span>
      <h1 className="text-zinc-50 text-lg font-semibold tracking-tight">CASH</h1>
      <span className="text-zinc-400 text-sm">Collaborative Agents Shell</span>
      <span className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
        {user && <span>signed in as <span className="text-zinc-200">{user}</span> · <button className="underline" onClick={() => { localStorage.removeItem("cash:user"); setUser(null); setTaskId(null); setData(null); setRoomId(null); }}>switch</button></span>}
        <a className="underline decoration-zinc-700 hover:text-zinc-300" href="https://github.com/juspay/xyne-spaces" target="_blank" rel="noreferrer">Xyne, open-source org OS</a>
      </span>
    </header>
  );
  if (!user) return (
    <main className="min-h-screen bg-[#141417] text-zinc-200">{header}
      <div className="max-w-md mx-auto mt-24 rounded-xl border border-zinc-700/60 bg-[#1b1b20] p-8">
        <h2 className="text-xl font-semibold text-zinc-50">Join the shell</h2>
        <p className="text-zinc-400 mt-2">Pick a username. Rooms, tasks and the agent's work are shared live. Your assistant is private to you and never acts without your approval.</p>
        <form onSubmit={login} className="mt-6 flex gap-2">
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="username" className="flex-1 rounded bg-black/40 border border-zinc-600 px-3 py-2 outline-none focus:border-zinc-300" autoFocus />
          <button className="rounded bg-zinc-100 text-zinc-900 px-4 py-2 font-medium">Enter</button>
        </form>
        {err && <div className="text-red-400 mt-3 text-sm">{err}</div>}
      </div>
    </main>
  );

  const room = rooms.find((r) => r.id === roomId);
  const lastBrief = priv ? [...priv.messages].reverse().find((m) => m.author === "assistant") : null;
  const pane = "min-h-0 flex flex-col bg-[#141417]";
  const paneHead = "px-4 py-2 border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-2";
  return (
    <main className="h-screen flex flex-col bg-[#141417] text-zinc-200">{header}
      <div className="bg-[#1b1b20] border-b border-zinc-800 px-5 py-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">you are in</span>
        <button className={`px-2 py-0.5 rounded ${!roomId ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:text-zinc-50"}`} onClick={() => { setRoomId(null); setTaskId(null); setData(null); }}>rooms</button>
        {roomId && <><span className="text-zinc-600">›</span><button className={`px-2 py-0.5 rounded ${!taskId ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:text-zinc-50"}`} onClick={() => { setTaskId(null); setData(null); }}>{room?.name ?? roomId}</button></>}
        {taskId && data && <><span className="text-zinc-600">›</span><span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-900">{data.task.title}</span><span className={`px-1.5 py-0.5 rounded text-xs ${badge(data.task.status)}`}>{data.task.status.replace("_", " ")}</span><span className="text-xs text-zinc-500">{data.task.type}</span>{data.working && <span className="text-xs text-indigo-300 animate-pulse">task agent working…</span>}</>}
      </div>
      {err && <div className="px-5 py-1.5 text-red-300 bg-red-950/40 border-b border-red-900/40 text-sm">{err}</div>}

      {!taskId && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] divide-x divide-zinc-800">
          <section className={`${pane} overflow-auto`}>
            <div className={paneHead}>{roomId ? "tasks in this room" : "rooms"}</div>
            <div className="p-4 space-y-2">
              {!roomId && rooms.map((r) => (
                <button key={r.id} onClick={() => { setRoomId(r.id); setTaskId(null); setData(null); }} className="w-full text-left rounded-lg border border-zinc-800 bg-[#1b1b20] hover:border-zinc-500 p-3">
                  <div className="text-zinc-50">{r.name}</div><div className="text-xs text-zinc-500">{r.task_count} tasks · by {r.created_by}</div>
                </button>
              ))}
              {!roomId && <form onSubmit={mkRoom} className="flex gap-2 pt-2"><input value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="new room name" className="flex-1 rounded bg-black/40 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400" /><button className="rounded bg-zinc-100 text-zinc-900 px-3 py-2">Create room</button></form>}
              {roomId && tasks.map((t) => (
                <button key={t.id} onClick={() => setTaskId(t.id)} className="w-full text-left rounded-lg border border-zinc-800 bg-[#1b1b20] hover:border-zinc-500 p-3 flex items-center gap-3">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500 w-10">{t.type}</span>
                  <span className="text-zinc-50 flex-1">{t.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${badge(t.status)}`}>{t.status.replace("_", " ")}</span>
                  <span className="text-xs text-zinc-600">{ago(t.updated_at)}</span>
                </button>
              ))}
              {roomId && <form onSubmit={mkTask} className="flex gap-2 pt-2"><input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="new task title" className="flex-1 rounded bg-black/40 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400" /><select value={newType} onChange={(e) => setNewType(e.target.value as TaskType)} className="rounded bg-black/40 border border-zinc-700 px-2 py-2">{["doc", "code", "image", "shell"].map((t) => <option key={t} value={t}>{t}</option>)}</select><button className="rounded bg-zinc-100 text-zinc-900 px-3 py-2">Create</button></form>}
            </div>
          </section>
          <section className={`${pane} overflow-auto`}>
            <div className={paneHead}>{roomId ? `what's going on in ${room?.name ?? "this room"}` : "what's going on across rooms"}</div>
            <Summary title={roomId ? "room summary" : "overview"} text={summary} loading={sumLoading} />
          </section>
        </div>
      )}

      {taskId && data && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,5fr)] divide-x divide-zinc-800">
          {/* collaborative space */}
          <section className={pane}>
            <div className={paneHead}>collaborative space <span className="text-zinc-600 normal-case tracking-normal">· everyone sees this</span></div>
            <div ref={streamRef} className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
              {data.messages.map((m) => {
                const agent = m.kind === "agent"; const sys = m.kind === "system" || m.kind === "context"; const cmd = m.kind === "command";
                return (
                  <div key={m.id} className={`rounded-lg px-3 py-2 ${agent ? "bg-indigo-500/10 border border-indigo-500/20" : sys ? "bg-transparent border border-zinc-800" : "bg-[#1b1b20]"}`}>
                    <div className="text-[11px] mb-0.5 flex gap-2"><span style={{ color: agent ? "#a5b4fc" : colorFor(m.author) }}>{m.author}</span><span className="text-zinc-600">{ago(m.created_at)} ago</span></div>
                    <Clamp text={m.body} mono={cmd} />
                  </div>
                );
              })}
            </div>
            <div className="border-t border-zinc-800 p-3 space-y-2">
              {help && <div className="flex flex-wrap gap-1.5 text-xs">{[["/agent ", "explicit instruction"], ["/status completed", "mark done"], ["/run", "run pipeline"], ["/help", "all commands"]].map(([c, d]) => <button key={c} title={d} onClick={() => { if (c.endsWith(" ")) setText(c); else send(c); }} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 font-mono text-amber-200/90">{c.trim()}</button>)}{tasks.filter((t) => t.id !== taskId).map((t) => <button key={t.id} onClick={() => send(`/pull ${t.id}`)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">pull: {t.title}</button>)}</div>}
              <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2">
                <button type="button" onClick={() => setHelp(!help)} className="rounded border border-zinc-700 px-2 text-zinc-400 hover:text-zinc-100">?</button>
                <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={busy ? "sending…" : "steer the task: say what you want"} className="flex-1 rounded bg-black/40 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400 disabled:opacity-60" />
                <button disabled={busy} className="rounded bg-zinc-100 text-zinc-900 px-3 py-2 disabled:opacity-50">Send</button>
              </form>
            </div>
          </section>
          {/* personal space */}
          <section className={`${pane} bg-[#17171c]`}>
            <div className={paneHead}>your assistant <span className="text-zinc-600 normal-case tracking-normal">· only you see this</span></div>
            {lastBrief && <div className="m-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3"><div className="text-[11px] text-indigo-300 mb-1">latest brief · {ago(lastBrief.created_at)} ago</div><div className="text-[13px] text-zinc-100 leading-relaxed whitespace-pre-wrap">{lastBrief.body.split("\n\nProposal #")[0]}</div></div>}
            {priv?.proposals.map((p) => (
              <div key={p.id} className="mx-3 mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-[11px] text-emerald-300 mb-1">needs your approval · #{p.id} · {p.action.replace("_", " ")}</div>
                <div className="text-[13px] text-zinc-100 leading-relaxed">{p.args.message ? `Post to the room as you: “${p.args.message}”` : p.args.instruction ?? p.args.status ?? ""}</div>
                {p.rationale && <div className="text-[12px] text-zinc-400 mt-1">{p.rationale}</div>}
                <div className="flex gap-2 mt-2"><button disabled={pbusy} onClick={() => decide(p.id, "approve")} className="rounded bg-emerald-400 text-zinc-950 px-3 py-1 text-sm font-medium disabled:opacity-50">Approve</button><button disabled={pbusy} onClick={() => decide(p.id, "decline")} className="rounded border border-zinc-600 px-3 py-1 text-sm disabled:opacity-50">Decline</button></div>
              </div>
            ))}
            <div ref={privRef} className="flex-1 min-h-0 overflow-auto px-3 pb-2 space-y-2">
              {priv?.messages.length === 0 && <div className="text-zinc-500 text-sm p-1">Your assistant reads the room for you, briefs you here, and can steer the task on your behalf once you approve. Ask it anything.</div>}
              {priv?.messages.map((m) => (
                <div key={m.id} className={`rounded-lg px-3 py-2 ${m.author === "assistant" ? "bg-[#1f1f26]" : "bg-[#1b1b20] border border-zinc-800"}`}>
                  <div className="text-[11px] mb-0.5 text-zinc-500">{m.author === "assistant" ? "assistant" : "you"} · {ago(m.created_at)} ago</div>
                  <Clamp text={m.body} />
                </div>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); talk(ptext); }} className="border-t border-zinc-800 p-3 flex gap-2">
              <input value={ptext} onChange={(e) => setPtext(e.target.value)} disabled={pbusy} placeholder={pbusy ? "thinking…" : "talk to your assistant"} className="flex-1 rounded bg-black/40 border border-zinc-700 px-3 py-2 outline-none focus:border-zinc-400 disabled:opacity-60" />
              <button disabled={pbusy} className="rounded bg-zinc-100 text-zinc-900 px-3 py-2 disabled:opacity-50">Ask</button>
            </form>
          </section>
          {/* agent workspace */}
          <section className={pane}>
            <div className={paneHead}>agent workspace {data.artifact && <span className="text-zinc-600 normal-case tracking-normal">· {data.task.type} · v{data.artifact.version} · {data.artifact.created_by} · {ago(data.artifact.created_at)} ago</span>}</div>
            <div className="flex-1 min-h-0 overflow-auto"><Viewer data={data} runs={runs} /></div>
          </section>
        </div>
      )}
    </main>
  );
}
