#!/usr/bin/env bash
# Usage: scripts/finalize.sh [DATABASE_URL]   (omit if the Neon marketplace integration already set it)
set -euo pipefail
cd "$(dirname "$0")/.."
SECRET=$(grep -h '^CRON_SECRET=' .env.local | head -1 | cut -d= -f2)
if [ "${1:-}" != "" ]; then
  printf '%s' "$1" | vercel env add DATABASE_URL production --force >/dev/null && echo "DATABASE_URL set (production)"
  grep -q '^DATABASE_URL=' .env.local || echo "DATABASE_URL=$1" >> .env.local
fi
echo "--- deploy"; vercel deploy --prod --yes 2>&1 | grep -oE 'Production +https://[^ ]+' | head -1
URL=https://xyne-cash.vercel.app
echo "--- setup (schema + seeds)"; curl -sS -X POST -H "Authorization: Bearer $SECRET" "$URL/api/setup" | head -c 400; echo
echo "--- tick (run everything due)"; curl -sS --max-time 290 -H "Authorization: Bearer $SECRET" "$URL/api/tick" | head -c 1500; echo
echo "--- state"; curl -sS "$URL/api/state" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("pipelines:",[p["id"] for p in d["pipelines"]]); print("runs:",[(r["pipeline_id"],r["status"],r["model_calls"],r.get("error")) for r in d["runs"][:8]]); print("inbox:",len(d["inbox"]))'
