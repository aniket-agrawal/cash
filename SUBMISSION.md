# Fast Forward Hack submission — Xyne presents CASH (Collaborative Agents Shell)

**Track:** Agents & Factories
**Side quest:** Build with Shopify (the `shop` command uses Shop MCP live, product URLs kept verbatim, nothing cached)

## Project name
CASH — Collaborative Agents Shell, by Xyne

## Short description (paste into the form)
CASH is a shell that a team and its agents share. Sign in with a username, enter a room, open a task. On the left, the conversation: people and agents steer in the same stream, with commands like /agent, /approve, /pull and /status. On the right, the agent at work: a code file, a document, an image or a scheduled pipeline, with a viewer that adapts to the task type. Everyone sees the same state live from Neon Postgres. Each person gets a background assistant that reads what others did, explains it, and proposes the next action; reading needs no permission, acting does, so you approve with one click. Context is unified: /pull brings another task's artifact and discussion into the one you are in. Shell tasks are Unix-style agent pipelines (small commands joined by pipes) that keep running on a schedule after you walk away. This is how Xyne, Juspay's open-source org OS, thinks about agents: shared context, permission-aware, people and agents in one place.

## How it meets the track criteria
- **Deployed on Vercel:** Next.js app and route handlers; Vercel Cron plus a heartbeat trigger.
- **Runs asynchronously / from schedules and events:** shell tasks become scheduled pipelines; background assistants run on a timer per user and task; `diff` state lives in Neon so a pipeline stops when nothing changed.
- **Useful work without a prompt per step:** release-risk briefs, research briefs with citations, Shop MCP price watch, assistants that summarize and propose.
- **Monitor and steer:** the shared stream shows every agent action with the model that served it; anyone can steer with a message, approve or decline proposals, pull context, change status, or `/run`.

## Technologies
Next.js 16 on Vercel · AI SDK + Vercel AI Gateway (anthropic/claude-haiku-5.5 for writing, meta/llama-4-maverick for filtering, automatic fallbacks) · Neon Postgres (rooms, tasks, messages, artifacts, proposals, pipelines, runs) · Vercel Cron + heartbeat · Shop MCP · GitHub, Hacker News and arXiv APIs

## Demo setup instructions for judges
Open the URL, enter any username, open the room "Fast Forward Hack". Open "CASH launch post" and type `/agent write a short launch post`. Open a second browser or incognito window with another username to see the shared stream update live. Wait about 40 seconds for your background assistant to post an understanding and a proposal, then click Approve. Try `/pull release-risk-watch` and `/status completed`. Open "Release risk watch" and type `/run`. Device requirements: none.

## Links
- Live: https://xyne-cash.vercel.app
- Pipeline shell view: https://xyne-cash.vercel.app/shell
- Repo: https://github.com/aniket-agrawal/cash
- Video: <YOUTUBE_URL>
