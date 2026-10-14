import { COMMANDS } from "../src/lib/commands";
import { splitPipes } from "../src/lib/text";
const ctx = { pipelineId: "smoke", runId: 0, stepIndex: 0, notes: [] as string[] };
async function run(spec: string) {
  let input = "";
  for (const stage of splitPipes(spec)) {
    const m = stage.match(/^(\S+)\s*([\s\S]*)$/)!;
    const t0 = Date.now();
    const r = await COMMANDS[m[1]].run(input, m[2], ctx);
    input = r.out;
    console.log(`  ${m[1]} ${m[2]} -> ${r.out.length} chars in ${Date.now() - t0}ms`);
  }
  console.log("  OUTPUT:", input.split("\n").slice(0, 4).join("\n          "), "\n");
}
(async () => {
for (const spec of [
  "gh-releases vercel/next.js -n 3 | head -n 6",
  'hn "ai agents" -n 5 | grep -v show',
  'arxiv "autonomous agents" -n 3',
  'shop "low profile mechanical keyboard" --max 150 -n 4',
  'fetch https://hnrss.org/newest?q=vercel | head -n 4',
]) {
  console.log("$", spec);
  try { await run(spec); } catch (e) { console.log("  FAILED:", e instanceof Error ? e.message : e, "\n"); }
}
})();
