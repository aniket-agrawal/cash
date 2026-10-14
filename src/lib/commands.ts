import { llm } from "./llm";
import { shopSearch } from "./shop";
import { kvGet, kvSet, q } from "./db";
import { tokenize, flag, positional, parseFeed, stripTags } from "./text";

export interface Ctx { pipelineId: string; runId: number; stepIndex: number; notes: string[] }
export interface StepResult { out: string; model?: string; ms?: number; tokens?: number }
export interface Command { name: string; help: string; run: (input: string, args: string, ctx: Ctx) => Promise<StepResult> }

const UA = "CASH/0.1 (Collaborative Agent Shell; https://github.com/aniket-agrawal/cash)";

function notesBlock(ctx: Ctx) {
  return ctx.notes.length ? `\n\nOPERATOR NOTES (a human steering this agent wrote these; follow them):\n${ctx.notes.map((n) => `- ${n}`).join("\n")}` : "";
}
const SYSTEM = "You are one step in a Unix-style agent pipeline. Your input arrives on stdin. Do exactly one job. Output plain text only: no preamble, no markdown headers, no apologies. Preserve URLs exactly as given.";

export const COMMANDS: Record<string, Command> = {
  fetch: {
    name: "fetch", help: "fetch <url>  — GET a page, RSS or Atom feed; emits plain text",
    async run(_in, args) {
      const [url] = positional(tokenize(args));
      if (!url) throw new Error("fetch: url required");
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/json, text/html;q=0.9, */*;q=0.8" } });
      if (!res.ok) throw new Error(`fetch: HTTP ${res.status} for ${url}`);
      const ct = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const isFeed = ct.includes("xml") || /<rss|<feed|<\?xml/i.test(body.slice(0, 500));
      const out = isFeed ? parseFeed(body) : ct.includes("json") ? body.slice(0, 20000) : stripTags(body).slice(0, 20000);
      return { out };
    },
  },
  "gh-releases": {
    name: "gh-releases", help: "gh-releases <owner/repo> [-n 5]  — latest GitHub releases with notes",
    async run(_in, args) {
      const t = tokenize(args); const [repo] = positional(t); const n = Number(flag(t, "-n") ?? 5);
      if (!repo) throw new Error("gh-releases: owner/repo required");
      const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": UA };
      if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${n}`, { headers });
      if (!res.ok) throw new Error(`gh-releases: HTTP ${res.status}`);
      const rel = (await res.json()) as { tag_name: string; published_at: string; html_url: string; body: string | null; prerelease: boolean }[];
      const out = rel.map((r) => `## ${r.tag_name}${r.prerelease ? " (prerelease)" : ""} — ${r.published_at?.slice(0, 10)} — ${r.html_url}\n${(r.body ?? "").replace(/\r/g, "").slice(0, 1500)}`).join("\n\n");
      return { out };
    },
  },
  hn: {
    name: "hn", help: 'hn "<query>" [-n 15]  — newest Hacker News stories matching query',
    async run(_in, args) {
      const t = tokenize(args); const [query] = positional(t); const n = Number(flag(t, "-n") ?? 15);
      const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query ?? "")}&tags=story&hitsPerPage=${n}`, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`hn: HTTP ${res.status}`);
      const j = (await res.json()) as { hits: { title: string; url: string | null; objectID: string; points: number; num_comments: number; created_at: string }[] };
      const out = j.hits.map((h) => `- ${h.title} — ${h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`} (${h.points} pts, ${h.num_comments} comments, ${h.created_at.slice(0, 10)}) discussion: https://news.ycombinator.com/item?id=${h.objectID}`).join("\n");
      return { out };
    },
  },
  arxiv: {
    name: "arxiv", help: 'arxiv "<query>" [-n 8]  — newest arXiv papers matching query',
    async run(_in, args) {
      const t = tokenize(args); const [query] = positional(t); const n = Number(flag(t, "-n") ?? 8);
      const res = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query ?? "")}&sortBy=submittedDate&sortOrder=descending&max_results=${n}`, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`arxiv: HTTP ${res.status}`);
      return { out: parseFeed(await res.text(), n) };
    },
  },
  shop: {
    name: "shop", help: 'shop "<query>" [--max 150] [-n 8]  — live Shopify catalog search via Shop MCP',
    async run(_in, args) {
      const t = tokenize(args); const [query] = positional(t);
      const max = flag(t, "--max"); const n = Number(flag(t, "-n") ?? 8);
      if (!query) throw new Error("shop: query required");
      const hits = await shopSearch(query, max ? Number(max) : undefined, n);
      const out = hits.map((h) => `- ${h.title} | ${h.price} | ${h.rating} | ${h.availability || "availability n/a"} | ${h.merchant} | ${h.url}`).join("\n");
      return { out };
    },
  },
  grep: {
    name: "grep", help: "grep [-v] <regex>  — keep (or drop with -v) matching lines",
    async run(input, args) {
      const t = tokenize(args); const invert = t.includes("-v"); const [pat] = positional(t);
      const re = new RegExp(pat ?? "", "i");
      return { out: input.split("\n").filter((l) => re.test(l) !== invert).join("\n") };
    },
  },
  head: {
    name: "head", help: "head [-n 10]  — first n lines",
    async run(input, args) {
      const t = tokenize(args); const n = Number(flag(t, "-n") ?? positional(t)[0] ?? 10);
      return { out: input.split("\n").slice(0, n).join("\n") };
    },
  },
  diff: {
    name: "diff", help: "diff  — emit only lines not seen in this pipeline's previous run (state in Neon); empty output stops the pipeline",
    async run(input, _args, ctx) {
      const key = `diff:${ctx.pipelineId}:${ctx.stepIndex}`;
      const prev = await kvGet<string[]>(key);
      const cur = input.split("\n").map((l) => l.trimEnd()).filter(Boolean);
      // Treat an item as a block starting at a non-indented line; indented lines belong to the previous block.
      const blocks: string[] = [];
      for (const l of cur) { if (/^\s/.test(l) && blocks.length) blocks[blocks.length - 1] += "\n" + l; else blocks.push(l); }
      await kvSet(key, blocks);
      if (!prev) return { out: `(first run: ${blocks.length} items, baseline stored)\n` + blocks.join("\n") };
      const seen = new Set(prev);
      const fresh = blocks.filter((b) => !seen.has(b));
      return { out: fresh.length ? `(${fresh.length} new/changed of ${blocks.length})\n` + fresh.join("\n") : "" };
    },
  },
  filter: {
    name: "filter", help: 'filter "<criterion>"  — LLM (cheap tier) keeps only lines matching the criterion',
    async run(input, args, ctx) {
      const [criterion] = positional(tokenize(args));
      if (!input.trim()) return { out: "" };
      const r = await llm(`Keep only the input lines that match this criterion: ${criterion}\nReturn the matching lines verbatim, one per line, including their URLs. If none match, return exactly NONE.${notesBlock(ctx)}\n\n--- stdin ---\n${input}`, "cheap", SYSTEM);
      const out = /^\s*NONE\s*$/.test(r.text) ? "" : r.text.trim();
      return { out, model: r.model, ms: r.ms, tokens: r.inputTokens + r.outputTokens };
    },
  },
  llm: {
    name: "llm", help: 'llm "<instruction>"  — LLM (smart tier) transforms stdin per instruction',
    async run(input, args, ctx) {
      const [instruction] = positional(tokenize(args));
      const r = await llm(`${instruction}${notesBlock(ctx)}\n\n--- stdin ---\n${input}`, "smart", SYSTEM);
      return { out: r.text.trim(), model: r.model, ms: r.ms, tokens: r.inputTokens + r.outputTokens };
    },
  },
  brief: {
    name: "brief", help: 'brief ["focus"]  — LLM writes an operator brief with citations from stdin',
    async run(input, args, ctx) {
      const [focus] = positional(tokenize(args));
      const r = await llm(`Write a brief for a busy operator${focus ? ` focused on: ${focus}` : ""}.\nFormat: one headline line; then 3-6 bullets, each ending with its source URL from stdin in parentheses; then one line starting with "Action:" or "Risk:" if warranted. Under 180 words. Only use facts present in stdin.${notesBlock(ctx)}\n\n--- stdin ---\n${input}`, "smart", SYSTEM);
      return { out: r.text.trim(), model: r.model, ms: r.ms, tokens: r.inputTokens + r.outputTokens };
    },
  },
  notify: {
    name: "notify", help: 'notify ["title"]  — deliver stdin to the inbox (and WEBHOOK_URL if set); passes stdin through',
    async run(input, args, ctx) {
      if (!input.trim()) return { out: "" };
      const [title] = positional(tokenize(args));
      await q("insert into inbox (pipeline_id, run_id, title, body) values ($1,$2,$3,$4)", [ctx.pipelineId, ctx.runId, title ?? ctx.pipelineId, input]);
      const hook = process.env.WEBHOOK_URL;
      if (hook) { try { await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `*${title ?? ctx.pipelineId}*\n${input}` }) }); } catch {} }
      return { out: input };
    },
  },
};

export function helpText(): string {
  return Object.values(COMMANDS).map((c) => c.help).join("\n");
}
