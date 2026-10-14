import { generateText } from "ai";
const t0 = Date.now();
try {
  const r = await generateText({ model: "meta/llama-4-maverick", prompt: "Reply with exactly: ok", providerOptions: { gateway: { models: ["openai/gpt-5-nano"] } } });
  console.log("gateway ok:", JSON.stringify(r.text).slice(0, 60), "| served by:", r.response?.modelId, "|", Date.now() - t0, "ms");
} catch (e) { console.log("gateway FAIL:", e?.message?.slice(0, 500) ?? e); }
