import { generateText } from "ai";

// Model tiers routed through Vercel AI Gateway with automatic fallbacks.
// Cheap tier handles filtering/classification; smart tier writes briefs.
export const TIERS = {
  cheap: { model: "meta/llama-4-maverick", fallbacks: ["openai/gpt-5-nano", "google/gemini-2.5-flash-lite"] },
  smart: { model: "anthropic/claude-haiku-5.5", fallbacks: ["openai/gpt-5-mini", "google/gemini-3-flash"] },
} as const;

export type Tier = keyof typeof TIERS;

export interface LlmResult {
  text: string;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

export async function llm(prompt: string, tier: Tier = "smart", system?: string): Promise<LlmResult> {
  const t = TIERS[tier];
  const started = Date.now();
  const res = await generateText({
    model: t.model,
    system,
    prompt,
    providerOptions: { gateway: { models: [...t.fallbacks] } },
  });
  const ms = Date.now() - started;
  const meta = (res.providerMetadata ?? {}) as Record<string, unknown>;
  const gw = (meta.gateway ?? {}) as Record<string, unknown>;
  const routing = (gw.routing ?? {}) as Record<string, unknown>;
  const served =
    (typeof routing.finalModel === "string" && routing.finalModel) ||
    res.response?.modelId ||
    t.model;
  return {
    text: res.text,
    model: String(served),
    ms,
    inputTokens: res.usage?.inputTokens ?? 0,
    outputTokens: res.usage?.outputTokens ?? 0,
  };
}
