export type CanonicalIdentity = {
  canonicalId: string;
  name: string;
  provider: string;
  aliases: string[];
  mappingConfidence: "exact" | "explicit_alias";
};

const REGISTRY = [
  {
    canonicalId: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    aliases: [
      "openai/gpt-4o",
      "gpt-4o",
      "gpt-4o-2024-11-20",
      "gpt-4o-2024-08-06",
      "gpt-4o-2024-05-13",
      "GPT-4o (2024-05-13)",
    ],
  },
  { canonicalId: "anthropic/claude-opus-5", name: "Claude Opus 5", provider: "Anthropic", aliases: ["anthropic/claude-opus-5", "claude-opus-5", "Claude Opus 5 (max)"] },
  { canonicalId: "anthropic/claude-fable-5", name: "Claude Fable 5", provider: "Anthropic", aliases: ["anthropic/claude-fable-5", "claude-fable-5", "Claude Fable 5 (with fallback)"] },
  { canonicalId: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "OpenAI", aliases: ["openai/gpt-5.6-sol", "gpt-5-6-sol", "GPT-5.6 Sol (max)"] },
  { canonicalId: "x-ai/grok-4.6", name: "Grok 4.6", provider: "xAI", aliases: ["x-ai/grok-4.6", "grok-4-6", "Grok 4.6 (high)"] },
  { canonicalId: "moonshotai/kimi-k3", name: "Kimi K3", provider: "Moonshot AI", aliases: ["moonshotai/kimi-k3", "kimi-k3", "Kimi K3 (max)"] },
  { canonicalId: "qwen/qwen3.8-max", name: "Qwen3.8 Max", provider: "Qwen", aliases: ["qwen/qwen3.8-max", "qwen3-8-max", "Qwen3.8 Max"] },
  { canonicalId: "meta/muse-spark-1.2", name: "Muse Spark 1.2", provider: "Meta", aliases: ["meta/muse-spark-1.2", "muse-spark-1-2", "Muse Spark 1.2 (xhigh)"] },
  { canonicalId: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "OpenAI", aliases: ["openai/gpt-5.6-terra", "gpt-5-6-terra", "GPT-5.6 Terra (max)"] },
  { canonicalId: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "Google", aliases: ["google/gemini-3.7-flash", "gemini-3-7-flash", "Gemini 3.7 Flash (high)"] },
  { canonicalId: "deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813", provider: "DeepSeek", aliases: ["deepseek/deepseek-v4-pro-0813", "deepseek-v4-pro", "DeepSeek V4 Pro 0813 (max)"] },
  { canonicalId: "z-ai/glm-5.2", name: "GLM 5.2", provider: "Z.ai", aliases: ["z-ai/glm-5.2", "glm-5-2", "GLM-5.2 (max)"] },
  { canonicalId: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "OpenAI", aliases: ["openai/gpt-5.6-luna", "gpt-5-6-luna", "GPT-5.6 Luna (max)"] },
  { canonicalId: "qwen/qwen3.8-27b", name: "Qwen3.8 27B", provider: "Qwen", aliases: ["qwen/qwen3.8-27b", "qwen3-8-27b", "Qwen3.8 27B"] },
  { canonicalId: "minimax/minimax-m3", name: "MiniMax M3", provider: "MiniMax", aliases: ["minimax/minimax-m3", "minimax-m3", "MiniMax-M3"] },
  { canonicalId: "thinkingmachines/inkling", name: "Inkling", provider: "Thinking Machines", aliases: ["thinkingmachines/inkling", "inkling", "Inkling"] },
  { canonicalId: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", provider: "NVIDIA", aliases: ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia-nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra"] },
  { canonicalId: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", provider: "Google", aliases: ["google/gemini-3.5-flash-lite", "gemini-3-5-flash-lite", "Gemini 3.5 Flash-Lite"] },
  { canonicalId: "meta/muse-glimmer-30b", name: "Muse Glimmer 30B", provider: "Meta", aliases: ["meta/muse-glimmer-30b", "muse-glimmer", "Muse Glimmer (high)"] },
  { canonicalId: "google/gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", provider: "Google", aliases: ["google/gemini-3.1-flash-tts-preview", "gemini-3-1-flash-tts", "Gemini 3.1 Flash TTS"] },
  { canonicalId: "openai/gpt-oss-120b", name: "gpt-oss-120b", provider: "OpenAI", aliases: ["openai/gpt-oss-120b", "gpt-oss-120b", "gpt-oss-120b (high)", "GPT-oss-120B(high)"] },
  { canonicalId: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super", provider: "NVIDIA", aliases: ["nvidia/nemotron-3-super-120b-a12b", "nvidia-nemotron-3-super-120b-a12b", "Nemotron 3 Super"] },
  { canonicalId: "nvidia/nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", provider: "NVIDIA", aliases: ["nvidia/nemotron-3.5-lightning", "nemotron-3-5-lightning", "Nemotron 3.5 Lightning"] },
  { canonicalId: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", aliases: ["anthropic/claude-haiku-4.5", "claude-4.5-haiku-reasoning", "Claude 4.5 Haiku"] },
  { canonicalId: "fish-audio/s2-pro", name: "Fish Audio S2 Pro", provider: "Fish Audio", aliases: ["fish-audio/s2-pro", "s2-pro", "Fish Audio S2 Pro"] },
  { canonicalId: "fish-audio/s2.1-pro", name: "Fish Audio S2.1 Pro", provider: "Fish Audio", aliases: ["fish-audio/s2.1-pro", "s2-1-pro", "Fish Audio S2.1 Pro"] },
  { canonicalId: "qwen/qwen-audio-3.0-tts-plus", name: "Qwen Audio 3.0 TTS Plus", provider: "Qwen", aliases: ["qwen/qwen-audio-3.0-tts-plus", "qwen-audio-3-0-tts-plus", "Qwen-Audio-3.0-TTS-Plus"] },
] as const;

function identityKey(value: string) {
  return value.trim().toLowerCase();
}

export function resolveCanonicalIdentity(source: string, sourceModelId: string, sourceName?: string): CanonicalIdentity | null {
  if ((source === "openrouter" || source === "open_asr") && sourceModelId.includes("/")) {
    const providerId = sourceModelId.split("/")[0];
    const registered = REGISTRY.find((item) => item.canonicalId === identityKey(sourceModelId));
    return {
      canonicalId: identityKey(sourceModelId),
      name: registered?.name ?? sourceName ?? sourceModelId,
      provider: registered?.provider ?? providerId,
      aliases: registered ? [...registered.aliases] : [sourceModelId],
      mappingConfidence: "exact",
    };
  }

  const candidates = [sourceModelId, sourceName].filter((value): value is string => Boolean(value)).map(identityKey);
  const registered = REGISTRY.find((item) => item.aliases.some((alias) => candidates.includes(identityKey(alias))));
  if (!registered) return null;
  return { ...registered, aliases: [...registered.aliases], mappingConfidence: candidates.includes(identityKey(registered.canonicalId)) ? "exact" : "explicit_alias" };
}

export function registeredModels() {
  return REGISTRY.map((item) => ({ ...item, aliases: [...item.aliases] }));
}
