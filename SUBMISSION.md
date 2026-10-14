# Fast Forward Hack submission — CASH (Collaborative Agent Shell)

**Track:** Agents & Factories
**Side quest:** Build with Shopify (Shop MCP powers the `shop` command, live catalog, URLs kept verbatim, no caching)

## Project name
CASH — Collaborative Agent Shell, by Xyne

## Short description (paste into the form)
Agents today are monoliths you babysit. Unix solved that in 1973: small programs that do one thing, speak plain text, compose with pipes, run from cron, and can be watched and killed by an operator. CASH (Collaborative Agent Shell) is that philosophy for AI agents, in a shell your whole team shares: anyone can tail, steer or kill any agent. Every agent is a tiny command (`gh-releases`, `hn`, `arxiv`, `shop`, `diff`, `filter`, `brief`, `notify`). You compose them with `|`, schedule them, and they keep producing briefs after you walk away. `tail -f` shows every run, step, model and token; `steer <id> <note>` changes the next run; `kill`/`start` pause and resume; `pipe` creates a new agent live. `diff` stops a pipeline when nothing changed, so no tokens are spent. Built by the Xyne team at Juspay: this is how Xyne, our open-source org OS, treats agents and context, reduced to a shell you can run on Vercel in an afternoon.

## How it meets the track criteria
- **Deployed on Vercel:** Next.js app, route handlers, Vercel Cron (`/api/tick`) plus a portable GitHub Actions ticker every 5 minutes.
- **Runs asynchronously / from schedules:** every pipeline has `every N minutes`; the scheduler runs whatever is due, no prompt per step.
- **Produces useful work without manual prompting:** seeded agents deliver a Next.js release-risk brief, an hourly agents-research brief with citations, an arXiv digest, and a Shop MCP price watch.
- **Monitor and steer:** live `tail -f` of runs with per-step model, latency and tokens; inbox of delivered briefs; `steer`, `kill`, `start`, `pipe`, `rm` from the web terminal.

## Technologies
Next.js 16 on Vercel · AI SDK + Vercel AI Gateway (meta/llama-4-maverick for filtering, anthropic/claude-haiku-5.5 for briefs, automatic fallbacks to openai and google models) · Neon Postgres (pipelines, runs, steer queue, inbox, diff state) · Vercel Cron + GitHub Actions ticker · Shop MCP (mcp.shop.com) · GitHub, Hacker News and arXiv APIs

## Demo setup instructions for judges
Open the deployed URL. No login. Press **run** on any agent or type `run agent-research` in the terminal; a run appears in `tail -f` within seconds. Try `steer keyboard-price-watch only show items under $100` then run it again. Try `pipe quest-watch every 10m shop "meta quest 3" | diff | brief`. Device requirements: none.

## Links
- Live: <PRODUCTION_URL>
- Repo: https://github.com/aniket-agrawal/CASH
- Video: <YOUTUBE_URL>

---

# 3-minute demo video script (record at 3:40pm, screen + voice)

**0:00–0:25 — Problem.** "Every agent demo is a chat box with a timer. You babysit it, you re-prompt it, and it's a monolith. Unix solved this in 1973: small programs, text streams, pipes, cron, and an operator who can tail and kill anything. We built that for agents." Show the header: Xyne presents CASH.

**0:25–1:05 — The shell.** Point at `ps`: four scheduled agents, each a pipeline of tiny commands. Read one aloud: `gh-releases vercel/next.js | diff | brief`. "Each command does one thing. diff keeps state in Neon and stops the pipeline when nothing changed, so a quiet hour costs zero tokens." Click `run next-release-risk`; watch `tail -f` fill: step by step, with the model that served each step via AI Gateway and its latency.

**1:05–1:45 — It keeps working.** Scroll runs: several `cron` runs already happened without anyone prompting. Open the inbox: a delivered research brief with citations. "That's the factory: cron ticks, agents run, briefs land."

**1:45–2:20 — Steer and compose.** Type `steer agent-research focus on security incidents` and `run agent-research`; show the brief changed. Then `pipe quest-watch every 10m shop "meta quest 3" | diff | brief` and run it: live Shopify catalog results via Shop MCP turned into a brief. "New agent, one line, no deploy."

**2:20–2:50 — Why Xyne.** Cut to a 10-second clip of Xyne Spaces. "This is how Xyne, Juspay's open-source org OS, thinks: your organization is a filesystem of context that agents ls, grep and tail as the person who invoked them, permission-aware by default, small sandboxed tools instead of one monolith. CASH is that philosophy reduced to a shell on Vercel, AI Gateway and Neon."

**2:50–3:00 — Close.** "CASH. Unix pipes for agents that keep working. Open source, link in the submission."
