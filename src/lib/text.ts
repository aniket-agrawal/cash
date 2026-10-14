export function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Split a pipeline spec on `|` that are not inside quotes. */
export function splitPipes(spec: string): string[] {
  const parts: string[] = [];
  let cur = "", quote: string | null = null;
  for (const ch of spec) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "|") { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

export function flag(tokens: string[], name: string): string | undefined {
  const i = tokens.indexOf(name);
  return i >= 0 ? tokens[i + 1] : undefined;
}
export function positional(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith("-")) { i++; continue; }
    out.push(tokens[i]);
  }
  return out;
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}

/** Parse RSS or Atom into plain text lines. */
export function parseFeed(xml: string, max = 20): string {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const lines: string[] = [];
  for (const it of items.slice(0, max)) {
    const title = stripTags(tag(it, "title"));
    let link = stripTags(tag(it, "link"));
    if (!link) { const m = it.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ""; }
    const date = tag(it, "pubDate") || tag(it, "published") || tag(it, "updated");
    const summary = stripTags(tag(it, "description") || tag(it, "summary") || tag(it, "content")).slice(0, 280);
    lines.push(`- ${title} — ${link}${date ? ` (${date.slice(0, 16)})` : ""}${summary ? `\n  ${summary}` : ""}`);
  }
  return lines.join("\n");
}
