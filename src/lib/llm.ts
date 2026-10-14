import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

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

// Escape hatch: if a direct provider key is configured, bypass the Gateway (LLM_PROVIDER=anthropic|openai|gateway).
function directModel(tier: Tier): { model: LanguageModel; label: string } | null {
  const pref = process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "gateway");
  if (pref === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const id = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
    return { model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(id), label: `anthropic:${id} (direct)` };
  }
  if (pref === "openai" && process.env.OPENAI_API_KEY) {
    const id = process.env.OPENAI_MODEL ?? (tier === "cheap" ? "gpt-5-nano" : "gpt-5-mini");
    return { model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(id), label: `openai:${id} (direct)` };
  }
  return null;
}

export async function llm(prompt: string, tier: Tier = "smart", system?: string): Promise<LlmResult> {
  const t = TIERS[tier];
  const started = Date.now();
  const direct = directModel(tier);
  const res = await generateText({
    model: direct ? direct.model : t.model,
    system,
    prompt,
    ...(direct ? {} : { providerOptions: { gateway: { models: [...t.fallbacks] } } }),
  });
  const ms = Date.now() - started;
  const meta = (res.providerMetadata ?? {}) as Record<string, unknown>;
  const gw = (meta.gateway ?? {}) as Record<string, unknown>;
  const routing = (gw.routing ?? {}) as Record<string, unknown>;
  const served = direct
    ? direct.label
    : (typeof routing.finalModel === "string" && routing.finalModel) || res.response?.modelId || t.model;
  return {
    text: res.text,
    model: String(served),
    ms,
    inputTokens: res.usage?.inputTokens ?? 0,
    outputTokens: res.usage?.outputTokens ?? 0,
  };
}
