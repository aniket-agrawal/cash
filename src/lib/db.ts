import { neon } from "@neondatabase/serverless";

export type Row = Record<string, unknown>;

let _sql: ReturnType<typeof neon> | null = null;
export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await sql().query(text, params);
  return rows as unknown as T[];
}

export async function kvGet<T = unknown>(k: string): Promise<T | null> {
  const rows = await q<{ v: T }>("select v from kv where k = $1", [k]);
  return rows[0]?.v ?? null;
}

export async function kvSet(k: string, v: unknown) {
  await q(
    "insert into kv (k, v, updated_at) values ($1, $2::jsonb, now()) on conflict (k) do update set v = excluded.v, updated_at = now()",
    [k, JSON.stringify(v)],
  );
}
