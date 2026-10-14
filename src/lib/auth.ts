export function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (local dev)
  const h = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  return h === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}
