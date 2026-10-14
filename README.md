# agentsh — a unix shell for agents that keep working

> Unix solved sprawl in 1973: small programs that do one thing, speak plain text, compose with pipes, run from cron, and can be watched and killed by an operator. agentsh applies that to AI agents.

Every agent is a tiny command. You compose them with `|`, schedule them, and operate them like processes:

```
gh-releases vercel/next.js -n 5 | diff | brief "breaking changes and migration risk"
hn "ai agents" -n 15 | diff | filter "about running agents in production" | brief | notify "research brief"
shop "low profile mechanical keyboard" --max 150 | diff | brief "price drops and best value" | notify "shop watch"
```

- **keeps working**: pipelines run from cron (Vercel Cron + a portable GitHub Actions ticker) with no prompt per step
- **monitor**: `tail -f` of every run, every step's model, latency and tokens, and the delivered inbox
- **steer**: `steer <id> <note>` injects operator notes into the next run; `kill`/`start` pause and resume; `pipe` creates a new agent live
- **cheap by construction**: `diff` stops the pipeline when nothing changed, so no tokens are spent; cheap models filter, smart models write, all via AI Gateway with automatic fallbacks

## Commands

`fetch` · `gh-releases` · `hn` · `arxiv` · `shop` (Shop MCP, live) · `grep` · `head` · `diff` · `filter` · `llm` · `brief` · `notify`

## Stack

Next.js on Vercel · AI SDK + Vercel AI Gateway (meta/llama-4-maverick for filtering, anthropic/claude-haiku-5.5 for briefs, with fallbacks) · Neon Postgres (pipelines, runs, steer queue, inbox, diff state) · Vercel Cron + GitHub Actions ticker · Shop MCP

## Philosophy

This is how [Xyne](https://github.com/juspay/xyne-spaces), Juspay's open-source org OS, thinks about agents: an organization is a filesystem of context that agents `ls`, `grep` and `tail` as the person who invoked them, permission-aware by default, with small sandboxed tools instead of one monolith. agentsh is that idea reduced to a shell you can run on Vercel in an afternoon.

## Run it

```
npm i && cp .env.example .env.local   # set DATABASE_URL (Neon) and CRON_SECRET
npm run dev
curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/setup   # schema + seed pipelines
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/tick            # run whatever is due
```
