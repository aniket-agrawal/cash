import { q } from "./db";
import { COMMANDS } from "./commands";
import { splitPipes } from "./text";

export interface Pipeline { id: string; name: string; spec: string; every_minutes: number; enabled: boolean; last_run_at: string | null }
export interface StepLog { i: number; cmd: string; args: string; ms: number; model?: string; tokens?: number; in: number; out: number; preview: string }

export async function runPipeline(p: Pipeline, trigger: "cron" | "manual") {
  const [run] = await q<{ id: number }>("insert into runs (pipeline_id, trigger) values ($1,$2) returning id", [p.id, trigger]);
  const runId = Number(run.id);
  const notes = (await q<{ message: string }>("update steer set consumed_at = now() where pipeline_id = $1 and consumed_at is null returning message", [p.id])).map((r) => r.message);
  const stages = splitPipes(p.spec);
  const steps: StepLog[] = [];
  let input = "";
  let modelCalls = 0;
  const t0 = Date.now();
  let status = "ok";
  let error: string | null = null;
  try {
    for (let i = 0; i < stages.length; i++) {
      const m = stages[i].match(/^(\S+)\s*([\s\S]*)$/);
      if (!m) continue;
      const [, cmd, args] = m;
      const command = COMMANDS[cmd];
      if (!command) throw new Error(`${cmd}: command not found`);
      const s0 = Date.now();
      const r = await command.run(input, args, { pipelineId: p.id, runId, stepIndex: i, notes });
      steps.push({ i, cmd, args, ms: r.ms ?? Date.now() - s0, model: r.model, tokens: r.tokens, in: input.length, out: r.out.length, preview: r.out.slice(0, 600) });
      if (r.model) modelCalls++;
      input = r.out;
      if (!input.trim() && i < stages.length - 1) {
        steps.push({ i: i + 1, cmd: "⏹ stop", args: "empty stdin — downstream steps skipped (no tokens spent)", ms: 0, in: 0, out: 0, preview: "" });
        status = "nochange";
        break;
      }
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  }
  await q(
    "update runs set status=$2, finished_at=now(), steps=$3::jsonb, output=$4, error=$5, model_calls=$6, latency_ms=$7 where id=$1",
    [runId, status, JSON.stringify(steps), input, error, modelCalls, Date.now() - t0],
  );
  await q("update pipelines set last_run_at = now() where id = $1", [p.id]);
  return { runId, status, error, steps: steps.length, modelCalls, ms: Date.now() - t0 };
}

export async function duePipelines(): Promise<Pipeline[]> {
  return q<Pipeline>("select * from pipelines where enabled and (last_run_at is null or last_run_at + (every_minutes || ' minutes')::interval <= now()) order by created_at");
}
