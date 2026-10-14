// Shop MCP (mcp.shop.com): no key needed. Results are fetched live, product URLs kept verbatim.
export interface ShopHit {
  title: string;
  price: string;
  rating: string;
  availability: string;
  url: string;
  merchant: string;
}

export async function shopSearch(query: string, maxUsd?: number, limit = 8): Promise<ShopHit[]> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        catalog: {
          query,
          context: { address_country: "US", currency: "USD" },
          ...(maxUsd ? { filters: { price: { max: Math.round(maxUsd * 100) } } } : {}),
          pagination: { limit },
        },
      },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "xyne-cash", version: "0.1.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
  const res = await fetch("https://mcp.shop.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "search_catalog",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Shop MCP HTTP ${res.status}`);
  const json = await res.json();
  const sc = json?.result?.structuredContent;
  if (!sc) throw new Error("Shop MCP: no structuredContent");
  const products: Record<string, unknown>[] = sc.products ?? [];
  return products.map((p) => {
    const variants = (p.variants as Record<string, unknown>[]) ?? [];
    const v0 = variants[0] ?? {};
    const pr = (p.price_range as { min?: { amount?: number; currency?: string } }) ?? {};
    const amount = pr.min?.amount;
    const price = typeof amount === "number" ? `$${(amount / 100).toFixed(2)}` : "n/a";
    const rating = (p.rating as { value?: number; count?: number }) ?? {};
    const url = String((v0 as { url?: string }).url ?? (p as { url?: string }).url ?? "");
    let merchant = "";
    try { merchant = new URL(url).hostname; } catch {}
    return {
      title: String(p.title ?? ""),
      price,
      rating: rating.value ? `${rating.value}★ (${rating.count ?? 0})` : "unrated",
      availability: String((v0 as { availability?: string }).availability ?? ""),
      url,
      merchant,
    };
  });
}
