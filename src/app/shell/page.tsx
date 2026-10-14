"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Pipeline = { id: string; name: string; spec: string; every_minutes: number; enabled: boolean; last_run_at: string | null };
type Step = { i: number; cmd: string; args: string; ms: number; model?: string; tokens?: number; in: number; out: number; preview: string };
type Run = { id: number; pipeline_id: string; started_at: string; finished_at: string | null; status: string; trigger: string; steps: Step[]; output: string | null; error: string | null; model_calls: number; latency_ms: number | null };
type Inbox = { id: number; pipeline_id: string; run_id: number; title: string; body: string; created_at: string };
type Steer = { id: number; pipeline_id: string; message: string; created_at: string; consumed_at: string | null };
type State = { now: string; pipelines: Pipeline[]; runs: Run[]; inbox: Inbox[]; steer: Steer[]; help: string };

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const statusColor = (s: string) => (s === "ok" ? "text-emerald-400" : s === "failed" ? "text-red-400" : s === "running" ? "text-amber-300" : "text-zinc-500");

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [console_, setConsole] = useState<string[]>(["cash 0.1 — type `help`"]);
  const [filterPid, setFilterPid] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error(`state ${r.status}`);
      setState(await r.json()); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);
  // Heartbeat: while a dashboard is open it pokes the scheduler once a minute (server-side rate-limited).
  useEffect(() => { const poke = () => fetch("/api/poke", { method: "POST" }).then(refresh).catch(() => {}); poke(); const t = setInterval(poke, 60_000); return () => clearInterval(t); }, [refresh]);

  const print = (s: string) => setConsole((c) => [...c.slice(-40), s]);
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `${r.status}`);
    return j;
  };

  const exec = async (line: string) => {
    const l = line.trim(); if (!l) return;
    print(`$ ${l}`);
    const [c, ...rest] = l.split(/\s+/);
    setBusy(true);
    try {
      if (c === "help") print(["run <id> · kill <id> · start <id> · tail <id> · steer <id> <note> · pipe <id> every <N>m <cmd | cmd ...> · rm <id>", "commands available in pipes:", state?.help ?? ""].join("\n"));
      else if (c === "run") { const r = await post("/api/run", { pipelineId: rest[0] }); print(`run #${r.runId}: ${r.status} in ${r.ms}ms, ${r.modelCalls} model calls${r.error ? ` — ${r.error}` : ""}`); }
      else if (c === "kill") { await post("/api/kill", { pipelineId: rest[0], enabled: false }); print(`${rest[0]} stopped`); }
      else if (c === "start") { await post("/api/kill", { pipelineId: rest[0], enabled: true }); print(`${rest[0]} scheduled`); }
      else if (c === "tail") { setFilterPid(rest[0] ?? null); print(rest[0] ? `tail -f ${rest[0]}` : "showing all"); }
      else if (c === "steer") { const r = await post("/api/steer", { pipelineId: rest[0], message: rest.slice(1).join(" ") }); print(`steer queued → ${r.note}`); }
      else if (c === "rm") { await fetch("/api/pipelines", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rest[0] }) }); print(`${rest[0]} removed`); }
      else if (c === "pipe") {
        const m = l.match(/^pipe\s+(\S+)\s+every\s+(\d+)m?\s+([\s\S]+)$/);
        if (!m) throw new Error("usage: pipe <id> every <N>m <cmd | cmd ...>");
        const r = await post("/api/pipelines", { id: m[1], everyMinutes: Number(m[2]), spec: m[3] });
        print(`${r.id} scheduled every ${r.every}m`);
      } else print(`${c}: command not found (try help)`);
    } catch (e) { print(`error: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false); setCmd(""); refresh();
  };

  const runs = useMemo(() => (state?.runs ?? []).filter((r) => !filterPid || r.pipeline_id === filterPid), [state, filterPid]);
  const pending = useMemo(() => (state?.steer ?? []).filter((s) => !s.consumed_at), [state]);

  return (
    <main className="min-h-screen bg-black text-zinc-200 font-mono text-[13px] leading-relaxed">
      <header className="border-b border-zinc-800 px-5 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a href="/" className="text-zinc-100 text-base font-semibold hover:underline">← CASH</a> <span className="text-zinc-400">/shell</span>
        <span className="flex items-center gap-1 text-zinc-500"><img src="/xyne.svg" alt="Xyne" className="h-4 inline-block opacity-90" /> presents CASH</span>
        <span className="text-zinc-400">Collaborative Agent Shell — unix pipes for agents that keep working</span>
        <span className="ml-auto text-zinc-500">small commands · text streams · pipes · cron + heartbeat · tail -f · kill · steer</span>
        <a className="text-zinc-500 underline decoration-zinc-700 hover:text-zinc-300" href="https://github.com/juspay/xyne-spaces" target="_blank" rel="noreferrer">Xyne, the open-source org OS</a>
      </header>
      {err && <div className="px-5 py-2 text-red-400 border-b border-red-900/40">state: {err} — is DATABASE_URL set and /api/setup run?</div>}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] gap-0 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
        <section className="p-4 min-w-0">
          <h2 className="text-zinc-500 mb-2">$ ps — scheduled agents</h2>
          <ul className="space-y-3">
            {(state?.pipelines ?? []).map((p) => (
              <li key={p.id} className={`rounded border ${p.enabled ? "border-zinc-800" : "border-zinc-900 opacity-60"} p-3`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={p.enabled ? "text-emerald-400" : "text-zinc-500"}>{p.enabled ? "●" : "○"}</span>
                  <button className="text-zinc-100 hover:underline" onClick={() => setFilterPid(filterPid === p.id ? null : p.id)}>{p.id}</button>
                  <span className="text-zinc-500">every {p.every_minutes}m · last {ago(p.last_run_at)}</span>
                  <span className="ml-auto flex gap-2">
                    <button disabled={busy} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 hover:border-emerald-500 disabled:opacity-40" onClick={() => exec(`run ${p.id}`)}>run</button>
                    <button disabled={busy} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 hover:border-red-500 disabled:opacity-40" onClick={() => exec(p.enabled ? `kill ${p.id}` : `start ${p.id}`)}>{p.enabled ? "kill" : "start"}</button>
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words text-amber-200/90">{p.spec.split("|").map((s, i) => (i ? "  | " : "") + s.trim()).join("\n")}</pre>
                {pending.filter((s) => s.pipeline_id === p.id).map((s) => (
                  <div key={s.id} className="mt-1 text-sky-300">↳ steer (next run): {s.message}</div>
                ))}
              </li>
            ))}
            {state && state.pipelines.length === 0 && <li className="text-zinc-500">no pipelines yet — try: pipe demo every 10m hn &quot;ai agents&quot; | brief</li>}
          </ul>
          <div className="mt-4 rounded border border-zinc-800 bg-zinc-950 p-3">
            <pre className="whitespace-pre-wrap break-words text-zinc-400 max-h-56 overflow-auto">{console_.join("\n")}</pre>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); exec(cmd); }}>
              <span className="text-emerald-400">$</span>
              <input ref={inputRef} value={cmd} onChange={(e) => setCmd(e.target.value)} disabled={busy} placeholder="run next-release-risk · steer agent-research focus on security · pipe my-watch every 10m shop &quot;quest 3&quot; | diff | brief" className="flex-1 bg-transparent outline-none text-zinc-100 placeholder:text-zinc-700" autoFocus />
            </form>
          </div>
        </section>

        <section className="p-4 min-w-0">
          <h2 className="text-zinc-500 mb-2">$ tail -f runs{filterPid ? ` — ${filterPid}` : ""} <span className="text-zinc-700">(live, refreshes every 3s)</span></h2>
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id} className="rounded border border-zinc-800 p-3">
                <button className="w-full text-left flex flex-wrap gap-x-3" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="text-zinc-500">#{r.id}</span>
                  <span className="text-zinc-100">{r.pipeline_id}</span>
                  <span className={statusColor(r.status)}>{r.status}</span>
                  <span className="text-zinc-500">{r.trigger} · {ago(r.started_at)} · {r.latency_ms ?? "…"}ms · {r.model_calls} model calls</span>
                </button>
                {r.error && <div className="text-red-400 mt-1">{r.error}</div>}
                {(open === r.id || r.id === runs[0]?.id) && (
                  <div className="mt-2 space-y-1">
                    {(r.steps ?? []).map((s) => (
                      <div key={s.i} className="text-zinc-400">
                        <span className="text-amber-200/90">{s.cmd}</span> {s.args} <span className="text-zinc-600">→ {s.out} chars · {s.ms}ms{s.model ? ` · ${s.model}` : ""}{s.tokens ? ` · ${s.tokens} tok` : ""}</span>
                      </div>
                    ))}
                    {r.output && <pre className="mt-2 whitespace-pre-wrap break-words text-zinc-200 bg-zinc-950 rounded p-2 max-h-72 overflow-auto">{r.output}</pre>}
                  </div>
                )}
              </li>
            ))}
            {state && runs.length === 0 && <li className="text-zinc-500">no runs yet — the scheduler will start them, or press run</li>}
          </ul>
        </section>

        <section className="p-4 min-w-0">
          <h2 className="text-zinc-500 mb-2">$ cat inbox — delivered briefs</h2>
          <ul className="space-y-2">
            {(state?.inbox ?? []).map((n) => (
              <li key={n.id} className="rounded border border-zinc-800 p-3">
                <div className="text-zinc-500">{n.title} · {n.pipeline_id} · run #{n.run_id} · {ago(n.created_at)}</div>
                <pre className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{n.body}</pre>
              </li>
            ))}
            {state && state.inbox.length === 0 && <li className="text-zinc-500">nothing delivered yet</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
