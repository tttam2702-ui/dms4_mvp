import { parse } from "csv-parse/sync";
import { resolveCanonicalIdentity } from "./model-registry";
import type { SourceId } from "./source-registry";
import { aiAccessMetadata, aiNativeMetadata, type AiFirstMetadata } from "../recommendation/ai-first";
import { OFFICIAL_AI_PRODUCTS } from "./product-catalog";

export const NORMALIZER_VERSIONS: Record<SourceId, number> = {
  artificial_analysis: 9,
  openrouter: 9,
  mmlu_pro: 4,
  open_asr: 1,
  openai_official: 3,
  official_products: 1,
};

export type NormalizedAccessOption = AiFirstMetadata & {
  label: string;
  url: string;
  modelId: string;
  sourceUrl: string;
  verifiedAt: number;
  productId?: string;
  productName?: string;
  planId?: string;
  planName?: string;
  accessMethod?: "product" | "api" | "marketplace" | "cloud";
  monthlyPriceUsd?: number;
};

export type NormalizedBenchmark = {
  metric: string;
  score: number;
  rawValue?: unknown;
  normalizedValue?: number;
  category?: string;
  sourceUrl?: string;
  modelVersion?: string;
  sourceVersion?: string;
  measuredAt: number;
  confidence: string;
  notes?: string;
};

export type NormalizedPrice = {
  pricingType: string;
  amount: number;
  unit: string;
  currency: string;
  sourceUrl?: string;
  modelVersion?: string;
  sourceVersion?: string;
  confidence?: string;
  notes?: string;
  effectiveAt: number;
};

export type NormalizedModel = Required<AiFirstMetadata> & {
  canonicalId: string;
  name: string;
  provider: string;
  aliases: string[];
  modalities: string[];
  capabilities: string[];
  contextWindow?: number;
  releaseDate?: string;
  active: boolean;
  status: "pending_evidence" | "eligible" | "manual_review" | "inactive";
  mappingConfidence: "exact" | "explicit_alias" | "unmatched";
  manualReviewRequired: boolean;
  regions: string[];
  accessOptions: NormalizedAccessOption[];
  benchmarks: NormalizedBenchmark[];
  prices: NormalizedPrice[];
  privacy: Array<{ level: string; sourceUrl: string; confidence: string; notes?: string }>;
  licenses: Array<{ commercialUse: boolean; sourceUrl: string; confidence: string; notes?: string }>;
  capabilityEvidence: Array<{ capabilities: string[]; category: string; sourceUrl: string; verifiedAt: number; confidence: string; notes?: string }>;
};

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord { return typeof value === "object" && value !== null ? value as JsonRecord : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown): number | undefined {
  const candidate = typeof value === "object" && value !== null ? record(value).score ?? record(value).value : value;
  const parsed = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate.replace(/[$,%]/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
function normalized(score: number) { return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score)); }
function unique(values: string[]) { return [...new Set(values)]; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function manualIdentity(source: string, sourceId: string, name: string, provider = "Unknown") {
  const stableId = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { canonicalId: `unmatched/${source}/${stableId}`, name, provider, aliases: [sourceId, name], mappingConfidence: "unmatched" as const };
}

const MMLU_CATEGORIES: Record<string, string> = {
  "Computer Science": "coding_knowledge",
  Engineering: "reasoning",
  Business: "finance",
  Economics: "finance",
  Math: "finance",
  Law: "legal",
  Health: "healthcare",
  Biology: "healthcare",
  Psychology: "healthcare",
  History: "research",
  Philosophy: "reasoning",
  Physics: "reasoning",
  Chemistry: "reasoning",
  Overall: "general",
  Other: "general",
};

function benchmarkCategory(metric: string) {
  if (/swe|software.engineer/i.test(metric)) return "software_engineering";
  if (/code|coding|program/i.test(metric)) return "coding";
  if (/law|legal/i.test(metric)) return "legal";
  if (/health|biology|medical|psychology/i.test(metric)) return "healthcare";
  if (/business|econom|finance/i.test(metric)) return "finance";
  if (/long|context/i.test(metric)) return "long_document";
  if (/mmmu|mmbench|multimodal/i.test(metric)) return "multimodal";
  if (/gpqa|mmlu|reason|intelligence|math/i.test(metric)) return "reasoning";
  if (/arena|preference|writing/i.test(metric)) return "writing";
  if (/speed|latency|token.*second/i.test(metric)) return "speed";
  return "general";
}

function pendingModel(identity: { canonicalId: string; name: string; provider: string; aliases: string[]; mappingConfidence: "exact" | "explicit_alias" | "unmatched" }, overrides: Partial<NormalizedModel> = {}): NormalizedModel {
  const capabilities = overrides.capabilities ?? [];
  return {
    canonicalId: identity.canonicalId,
    name: identity.name,
    provider: identity.provider,
    aliases: identity.aliases,
    modalities: [],
    capabilities,
    ...aiNativeMetadata(identity.name, capabilities),
    active: true,
    status: "pending_evidence",
    mappingConfidence: identity.mappingConfidence,
    manualReviewRequired: false,
    regions: [],
    accessOptions: [],
    benchmarks: [],
    prices: [],
    privacy: [],
    licenses: [],
    capabilityEvidence: [],
    ...overrides,
  };
}

export function normalizeOfficialProducts(payload: unknown, fetchedAt: number): NormalizedModel[] {
  const documents = new Map(list(record(payload).products).map((value) => {
    const item = record(value);
    return [text(item.id) ?? "", item];
  }));
  return OFFICIAL_AI_PRODUCTS.flatMap((definition) => {
    const document = documents.get(definition.id);
    if (!document || document.ok !== true) return [];
    const matchedTerms = list(document.matchedTerms).map(String);
    if (!definition.verificationTerms.every((term) => matchedTerms.includes(term))) return [];
    const metadata = {
      aiFirstClass: definition.aiFirstClass,
      aiRole: definition.aiRole,
      aiContributionLevel: "HIGH" as const,
      automationLevel: "HIGH" as const,
      requiredManualWork: definition.requiredManualWork,
    };
    return [pendingModel({ canonicalId: definition.id, name: definition.name, provider: definition.provider, aliases: [definition.id, definition.name], mappingConfidence: "exact" }, {
      modalities: [...definition.modalities],
      capabilities: [...definition.capabilities],
      ...metadata,
      status: "eligible",
      accessOptions: [{
        label: `Open ${definition.name}`,
        url: definition.accessUrl,
        modelId: definition.id,
        sourceUrl: definition.sourceUrl,
        verifiedAt: fetchedAt,
        productId: definition.id,
        productName: definition.name,
        planId: definition.planId,
        planName: definition.planName,
        accessMethod: "product",
        monthlyPriceUsd: definition.monthlyPriceUsd,
        ...metadata,
      }],
      capabilityEvidence: definition.categories.map((category) => ({
        capabilities: [...definition.capabilities],
        category,
        sourceUrl: definition.sourceUrl,
        verifiedAt: fetchedAt,
        confidence: "official_provider_docs",
        notes: definition.priceNote ?? "Capabilities verified against the provider's official product documentation. This is capability evidence, not a comparative performance benchmark.",
      })),
    })];
  });
}

export function normalizeArtificialAnalysis(payload: unknown, fetchedAt: number, sourceVersion?: string): NormalizedModel[] {
  const sourceUrl = "https://artificialanalysis.ai/models";
  const root = record(payload);
  const availableGoogleModels = new Set(list(root.googleModels).flatMap((raw) => {
    const name = text(record(raw).name);
    return name ? [name.replace(/^models\//, "")] : [];
  }));
  const googleAccess = (modelId: string): NormalizedAccessOption[] => availableGoogleModels.has(modelId) ? [{
    label: "Open in Google AI Studio",
    url: `https://aistudio.google.com/prompts/new_chat?model=${encodeURIComponent(modelId)}`,
    modelId,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    verifiedAt: fetchedAt,
    productId: "google-ai-studio",
    productName: "Google AI Studio",
    planId: "gemini-api-usage",
    planName: "Gemini API usage",
    accessMethod: "api",
    ...aiAccessMetadata("Google AI Studio", "api"),
  }] : [];
  const languageModels = list(root.data).flatMap((raw) => {
    const item = record(raw);
    const name = text(item.name);
    const sourceId = text(item.slug) ?? text(item.id) ?? name;
    if (!name || !sourceId) return [];
    const creator = record(item.model_creator);
    const identity = resolveCanonicalIdentity("artificial_analysis", sourceId, name) ?? manualIdentity("artificial_analysis", sourceId, name, text(creator.name) ?? "Unknown");
    const evaluations = record(item.evaluations);
    const pricing = record(item.pricing);
    const performance = record(item.performance);
    const benchmarks: NormalizedBenchmark[] = Object.entries(evaluations).flatMap(([metric, rawValue]) => {
      const score = number(rawValue);
      if (score === undefined) return [];
      const suppliedNormalized = number(record(rawValue).normalizedValue);
      return [{ metric, score, rawValue, normalizedValue: suppliedNormalized ?? normalized(score), category: benchmarkCategory(metric), sourceUrl, modelVersion: sourceId, sourceVersion, measuredAt: fetchedAt, confidence: "official_dataset", notes: suppliedNormalized === undefined ? "Reported by Artificial Analysis." : "Raw score reported by Artificial Analysis; the normalized value is its percentile within the current published comparison set." }];
    });
    const speed = number(performance.median_output_tokens_per_second);
    if (speed !== undefined) benchmarks.push({ metric: "output_tokens_per_second", score: speed, rawValue: speed, category: "speed", sourceUrl, modelVersion: sourceId, sourceVersion, measuredAt: fetchedAt, confidence: "official_api" });
    const prices: NormalizedPrice[] = [];
    const input = number(pricing.price_1m_input_tokens);
    const output = number(pricing.price_1m_output_tokens);
    if (input !== undefined) prices.push({ pricingType: "input_tokens", amount: input, unit: "1m_tokens", currency: "USD", sourceUrl, modelVersion: sourceId, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt });
    if (output !== undefined) prices.push({ pricingType: "output_tokens", amount: output, unit: "1m_tokens", currency: "USD", sourceUrl, modelVersion: sourceId, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt });
    const googleModelId = identity.provider === "Google" && identity.canonicalId.startsWith("google/") ? identity.canonicalId.slice("google/".length) : "";
    return [pendingModel(identity, { releaseDate: text(item.release_date), contextWindow: number(item.context_window_tokens ?? item.context_window), benchmarks, prices, accessOptions: googleModelId ? googleAccess(googleModelId) : [], status: identity.mappingConfidence === "unmatched" ? "manual_review" : "pending_evidence", manualReviewRequired: identity.mappingConfidence === "unmatched" })];
  });

  const providerForMediaPath = (path: string) => {
    const provider = path.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
    if (/openai|gpt|sora/.test(provider)) return "OpenAI";
    if (/gemini|google|veo/.test(provider)) return "Google";
    if (/microsoft/.test(provider)) return "Microsoft";
    if (/qwen|wan|happyhorse/.test(provider)) return "Alibaba";
    if (/seedream|seedance/.test(provider)) return "ByteDance";
    if (/grok/.test(provider)) return "xAI";
    if (/flux/.test(provider)) return "Black Forest Labs";
    if (/minimax|hailuo/.test(provider)) return "MiniMax";
    if (/kling/.test(provider)) return "Kuaishou";
    if (/skyreels/.test(provider)) return "SkyReels";
    if (/reve/.test(provider)) return "Reve";
    if (/hidream/.test(provider)) return "HiDream";
    return "Unknown";
  };

  const mediaModels = ([
    ...list(root.imageModels).map((raw) => ({ kind: "image" as const, item: record(raw) })),
    ...list(root.videoModels).map((raw) => ({ kind: "video" as const, item: record(raw) })),
  ]).flatMap(({ kind, item }) => {
    const name = text(item.name);
    const sourcePath = text(item.sourcePath);
    const quality = number(item.qualityElo);
    const normalizedQuality = number(item.normalizedQuality);
    const price = number(item.price);
    if (!name || !sourcePath || quality === undefined || price === undefined) return [];
    const mediaSourceUrl = `https://artificialanalysis.ai${sourcePath}`;
    const identity = {
      canonicalId: `artificial-analysis/${kind}/${slug(name)}`,
      name,
      provider: providerForMediaPath(sourcePath),
      aliases: [name, sourcePath],
      mappingConfidence: "exact" as const,
    };
    const googleMediaModelId = identity.provider === "Google" ? (() => {
      const value = name.toLowerCase();
      if (value.includes("nano banana 2 lite")) return "gemini-3.1-flash-lite-image";
      if (value.includes("nano banana 2")) return "gemini-3.1-flash-image";
      if (value.includes("nano banana pro")) return "gemini-3-pro-image";
      if (value.includes("gemini omni flash")) return "gemini-omni-flash-preview";
      if (value.includes("veo 3.1 lite")) return "veo-3.1-lite-generate-preview";
      if (value.includes("veo 3.1 fast")) return "veo-3.1-fast-generate-preview";
      if (value.includes("veo 3.1")) return "veo-3.1-generate-preview";
      return "";
    })() : "";
    return [pendingModel(identity, {
      modalities: kind === "image" ? ["text", "image"] : ["text", "image", "video"],
      capabilities: kind === "image" ? ["image_generation"] : ["video_generation"],
      accessOptions: googleMediaModelId ? googleAccess(googleMediaModelId) : [],
      benchmarks: [{
        metric: kind === "image" ? "artificial_analysis_image_arena_elo" : "artificial_analysis_video_arena_elo",
        score: quality,
        rawValue: quality,
        normalizedValue: normalizedQuality,
        category: kind,
        sourceUrl: mediaSourceUrl,
        modelVersion: sourcePath,
        sourceVersion,
        measuredAt: fetchedAt,
        confidence: "official_dataset",
        notes: "Blind-preference Arena Elo reported by Artificial Analysis; normalized value is its percentile within the current published comparison set.",
      }],
      prices: [{
        pricingType: kind === "image" ? "image_generation" : "video_generation",
        amount: price,
        unit: kind === "image" ? "1k_images" : "minute",
        currency: "USD",
        sourceUrl: mediaSourceUrl,
        modelVersion: sourcePath,
        sourceVersion,
        confidence: "official_dataset",
        notes: kind === "image" ? "Representative API price per 1,000 generated images." : "Representative API price per minute of generated video.",
        effectiveAt: fetchedAt,
      }],
    })];
  });

  const textToSpeechModels = list(root.textToSpeechModels).flatMap((raw) => {
    const item = record(raw);
    const name = text(item.name);
    const sourcePath = text(item.sourcePath);
    const quality = number(item.qualityElo);
    const normalizedQuality = number(item.normalizedQuality);
    if (!name || !sourcePath || quality === undefined) return [];
    const identity = resolveCanonicalIdentity("artificial_analysis", sourcePath.split("/").filter(Boolean).at(-1) ?? name, name);
    if (!identity) return [];
    const sourceUrl = `https://artificialanalysis.ai${sourcePath}`;
    const price = number(item.pricePer1mCharacters);
    const speed = number(item.charactersPerSecond);
    const benchmarks: NormalizedBenchmark[] = [{
      metric: "artificial_analysis_tts_arena_elo",
      score: quality,
      rawValue: quality,
      normalizedValue: normalizedQuality,
      category: "audio",
      sourceUrl,
      modelVersion: sourcePath,
      sourceVersion,
      measuredAt: fetchedAt,
      confidence: "official_dataset",
      notes: "Blind-preference Speech Arena Elo reported by Artificial Analysis.",
    }];
    if (speed !== undefined) benchmarks.push({ metric: "artificial_analysis_tts_characters_per_second", score: speed, rawValue: speed, category: "speed", sourceUrl, modelVersion: sourcePath, sourceVersion, measuredAt: fetchedAt, confidence: "official_dataset" });
    return [pendingModel(identity, {
      modalities: ["text", "speech"],
      capabilities: ["text_to_speech"],
      benchmarks,
      prices: price === undefined ? [] : [{ pricingType: "speech_generation", amount: price, unit: "1m_characters", currency: "USD", sourceUrl, modelVersion: sourcePath, sourceVersion, confidence: "official_dataset", effectiveAt: fetchedAt }],
    })];
  });

  return [...languageModels, ...mediaModels, ...textToSpeechModels];
}

export function normalizeOpenRouter(payload: unknown, fetchedAt: number, sourceVersion?: string): NormalizedModel[] {
  const root = record(payload);
  const rows = list(root.data).map(record);
  const imageModels = new Map(list(root.imageModels).map(record).flatMap((item) => text(item.id) ? [[text(item.id)!, item] as const] : []));
  const videoModels = new Map(list(root.videoModels).map(record).flatMap((item) => text(item.id) ? [[text(item.id)!, item] as const] : []));
  const percentileMap = (values: Array<{ id: string; score: number }>) => {
    const ranked = values.sort((a, b) => b.score - a.score);
    return new Map(ranked.map((item, index) => [item.id, ranked.length === 1 ? 100 : 40 + ((ranked.length - 1 - index) / (ranked.length - 1)) * 60]));
  };
  const artificialAnalysisMetrics = [
    { key: "intelligence_index", category: "reasoning" },
    { key: "coding_index", category: "coding" },
    { key: "agentic_index", category: "agentic" },
  ] as const;
  const artificialAnalysisPercentiles = new Map(artificialAnalysisMetrics.map(({ key }) => [key, percentileMap(rows.flatMap((item) => {
    const id = text(item.id); const score = number(record(record(item.benchmarks).artificial_analysis)[key]);
    return id && score !== undefined ? [{ id, score }] : [];
  }))]));
  const designScores = new Map<string, Array<{ id: string; score: number }>>();
  for (const item of rows) {
    const id = text(item.id); if (!id) continue;
    for (const raw of list(record(item.benchmarks).design_arena)) {
      const benchmark = record(raw); const arena = text(benchmark.arena); const category = text(benchmark.category); const score = number(benchmark.elo);
      if (!arena || !category || score === undefined) continue;
      const key = `${slug(arena)}_${slug(category)}`;
      designScores.set(key, [...(designScores.get(key) ?? []), { id, score }]);
    }
  }
  const designPercentiles = new Map([...designScores].map(([key, values]) => [key, percentileMap(values)]));

  return rows.flatMap((item) => {
    const id = text(item.id);
    const sourceName = text(item.name);
    if (!id) return [];
    const identity = resolveCanonicalIdentity("openrouter", id, sourceName);
    if (!identity) return [];
    const architecture = record(item.architecture);
    const pricing = record(item.pricing);
    const sourceUrl = `https://openrouter.ai/${id}`;
    const inputModalities = list(architecture.input_modalities).filter((value): value is string => typeof value === "string");
    const outputModalities = list(architecture.output_modalities).filter((value): value is string => typeof value === "string");
    const promptPrice = number(pricing.prompt);
    const completionPrice = number(pricing.completion);
    const prices: NormalizedPrice[] = [];
    if (outputModalities.includes("transcription")) {
      if (promptPrice !== undefined) prices.push({ pricingType: "speech_transcription", amount: promptPrice * 60, unit: "minute", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "OpenRouter transcription input price converted from seconds to minutes; provider-direct pricing may differ." });
    } else if (outputModalities.includes("speech")) {
      if (promptPrice !== undefined) prices.push({ pricingType: "speech_generation", amount: promptPrice * 1_000_000, unit: "1m_characters", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "OpenRouter speech price converted to one million input characters; provider-direct pricing may differ." });
    } else {
      if (promptPrice !== undefined) prices.push({ pricingType: "input_tokens", amount: promptPrice * 1_000_000, unit: "1m_tokens", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "OpenRouter route price; provider-direct pricing may differ." });
      if (completionPrice !== undefined) prices.push({ pricingType: "output_tokens", amount: completionPrice * 1_000_000, unit: "1m_tokens", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "OpenRouter route price; provider-direct pricing may differ." });
    }
    const imageMetadata = imageModels.get(id);
    const imagePrices = list(record(imageMetadata?.endpointDetails).endpoints).flatMap((rawEndpoint) => list(record(rawEndpoint).pricing).flatMap((rawPrice) => {
      const price = record(rawPrice); const cost = number(price.cost_usd);
      return price.billable === "output_image" && price.unit === "image" && cost !== undefined ? [cost] : [];
    }));
    if (imagePrices.length) prices.push({ pricingType: "image_generation", amount: Math.min(...imagePrices) * 1_000, unit: "1k_images", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "Lowest published OpenRouter output-image endpoint price, converted to 1,000 images. Resolution and provider options can change the final cost." });
    const videoPricingSkus = record(videoModels.get(id)?.pricing_skus);
    const videoPerMinute = Object.entries(videoPricingSkus).flatMap(([key, rawPrice]) => {
      const price = number(rawPrice); if (price === undefined) return [];
      if (key.startsWith("cents_per_") && key.includes("second") && key.includes("output")) return [(price / 100) * 60];
      if (key.includes("duration_seconds")) return [price * 60];
      return [];
    });
    if (videoPerMinute.length) prices.push({ pricingType: "video_generation", amount: Math.min(...videoPerMinute), unit: "minute", currency: "USD", sourceUrl, modelVersion: id, sourceVersion, confidence: "official_api", effectiveAt: fetchedAt, notes: "Lowest published OpenRouter per-second video SKU, converted to one minute. Resolution, audio, duration, and provider options can change the final cost." });
    const modalities = unique([...inputModalities, ...outputModalities]);
    const capabilities = new Set(list(item.supported_parameters).filter((value): value is string => typeof value === "string"));
    if (outputModalities.includes("image")) capabilities.add("image_generation");
    if (outputModalities.includes("video")) capabilities.add("video_generation");
    if (outputModalities.includes("speech") || outputModalities.includes("audio")) capabilities.add("text_to_speech");
    if (outputModalities.includes("transcription")) capabilities.add("speech_to_text");
    if (outputModalities.includes("embeddings")) capabilities.add("embeddings");
    if (outputModalities.includes("rerank")) capabilities.add("reranking");
    const benchmarks: NormalizedBenchmark[] = [];
    const artificialAnalysis = record(record(item.benchmarks).artificial_analysis);
    for (const { key, category } of artificialAnalysisMetrics) {
      const score = number(artificialAnalysis[key]);
      if (score === undefined) continue;
      benchmarks.push({ metric: `openrouter_artificial_analysis_${key}`, score, rawValue: score, normalizedValue: artificialAnalysisPercentiles.get(key)?.get(id), category, sourceUrl, modelVersion: id, sourceVersion, measuredAt: fetchedAt, confidence: "aggregated_third_party", notes: "Artificial Analysis score republished in the OpenRouter model catalog; normalized value is this model's percentile among currently listed models with the same metric." });
    }
    for (const rawBenchmark of list(record(item.benchmarks).design_arena)) {
      const benchmark = record(rawBenchmark); const arena = text(benchmark.arena); const categoryName = text(benchmark.category); const score = number(benchmark.elo);
      if (!arena || !categoryName || score === undefined) continue;
      const key = `${slug(arena)}_${slug(categoryName)}`;
      benchmarks.push({ metric: `openrouter_design_arena_${key}_elo`, score, rawValue: benchmark, normalizedValue: designPercentiles.get(key)?.get(id), category: "ui_ux_design", sourceUrl, modelVersion: id, sourceVersion, measuredAt: fetchedAt, confidence: "aggregated_third_party", notes: "Design Arena result republished in the OpenRouter model catalog; normalized value is this model's percentile for the same arena category." });
      capabilities.add("ui_generation");
    }
    const created = number(item.created);
    return [pendingModel(identity, {
      name: identity.name === id ? sourceName ?? id : identity.name,
      modalities,
      capabilities: [...capabilities],
      contextWindow: number(item.context_length),
      releaseDate: created ? new Date(created * 1_000).toISOString().slice(0, 10) : undefined,
      active: !text(item.expiration_date) || new Date(text(item.expiration_date)!).getTime() > fetchedAt,
      benchmarks,
      prices,
      accessOptions: [{
        label: "Open on OpenRouter",
        url: sourceUrl,
        modelId: id,
        sourceUrl: "https://openrouter.ai/api/v1/models?output_modalities=all",
        verifiedAt: fetchedAt,
        productId: "openrouter",
        productName: "OpenRouter",
        planId: "openrouter-api",
        planName: "Usage based API",
        accessMethod: "marketplace",
        ...aiAccessMetadata("OpenRouter", "marketplace"),
      }],
    })];
  });
}

export function normalizeOpenAsr(payload: unknown, fetchedAt: number, sourceVersion?: string): NormalizedModel[] {
  if (typeof payload !== "string") throw new Error("Open ASR payload must be CSV text");
  const sourceUrl = "https://huggingface.co/datasets/hf-audio/open-asr-leaderboard-results/resolve/main/english_short_latest.csv";
  const rows = parse(payload, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  const scored = rows.flatMap((row) => {
    const modelId = text(row.model);
    const wordErrorRate = number(row["avg cleaned"]);
    return modelId && wordErrorRate !== undefined ? [{ row, modelId, wordErrorRate }] : [];
  }).sort((a, b) => a.wordErrorRate - b.wordErrorRate);
  const percentiles = new Map(scored.map((item, index) => [
    item.modelId,
    scored.length === 1 ? 100 : 40 + ((scored.length - 1 - index) / (scored.length - 1)) * 60,
  ]));
  return scored.map(({ row, modelId, wordErrorRate }) => {
    const identity = resolveCanonicalIdentity("open_asr", modelId, modelId) ?? manualIdentity("open_asr", modelId, modelId);
    const speed = number(row.RTFx);
    const benchmarks: NormalizedBenchmark[] = [{
      metric: "open_asr_average_cleaned_wer",
      score: wordErrorRate,
      rawValue: { averageCleanedWer: wordErrorRate, averageOriginalWer: number(row["avg original"]) },
      normalizedValue: percentiles.get(modelId),
      category: "transcription",
      sourceUrl,
      modelVersion: modelId,
      sourceVersion,
      measuredAt: fetchedAt,
      confidence: "official_dataset",
      notes: "Average cleaned word error rate from the Open ASR Leaderboard; lower raw WER is better and the normalized value is the current leaderboard percentile.",
    }];
    if (speed !== undefined) benchmarks.push({
      metric: "open_asr_realtime_factor_x",
      score: speed,
      rawValue: speed,
      normalizedValue: normalized(speed),
      category: "speed",
      sourceUrl,
      modelVersion: modelId,
      sourceVersion,
      measuredAt: fetchedAt,
      confidence: "official_dataset",
      notes: "Reported transcription throughput relative to real time.",
    });
    return pendingModel(identity, {
      modalities: ["audio", "transcription"],
      capabilities: ["speech_to_text"],
      benchmarks,
      status: identity.mappingConfidence === "unmatched" ? "manual_review" : "pending_evidence",
      manualReviewRequired: identity.mappingConfidence === "unmatched",
    });
  });
}

export function normalizeMmluPro(payload: unknown, fetchedAt: number, sourceVersion?: string): NormalizedModel[] {
  if (typeof payload !== "string") throw new Error("MMLU-Pro payload must be CSV text");
  // The official dataset currently contains a row missing its final `Other` value.
  // Accept only short rows; csv-parse preserves every preceding header alignment and leaves the trailing field unavailable.
  const rows = parse(payload, { columns: true, skip_empty_lines: true, trim: true, relax_column_count_less: true }) as Record<string, string>[];
  if (!rows.length || !("Models" in rows[0]) || !("Overall" in rows[0])) throw new Error("MMLU-Pro CSV is missing required Models or Overall columns");
  const sourceUrl = "https://huggingface.co/datasets/TIGER-Lab/mmlu_pro_leaderboard_submission/resolve/main/results.csv";
  return rows.flatMap((row) => {
    const sourceName = text(row.Models);
    if (!sourceName) return [];
    const identity = resolveCanonicalIdentity("mmlu_pro", sourceName, sourceName) ?? manualIdentity("mmlu_pro", sourceName, sourceName, text(row["Data Source"]) ?? "Unknown");
    const benchmarks: NormalizedBenchmark[] = Object.entries(MMLU_CATEGORIES).flatMap(([column, category]) => {
      const score = number(row[column]);
      if (score === undefined) return [];
      return [{ metric: column === "Overall" ? "mmlu_pro_overall" : `mmlu_pro_${column.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, score, rawValue: row[column], normalizedValue: normalized(score), category, sourceUrl, modelVersion: sourceName, sourceVersion, measuredAt: fetchedAt, confidence: "official_dataset", notes: `MMLU-Pro leaderboard submission attributed to ${row["Data Source"] || "the listed submitter"}.` }];
    });
    return [pendingModel(identity, { benchmarks, status: identity.mappingConfidence === "unmatched" ? "manual_review" : "pending_evidence", manualReviewRequired: identity.mappingConfidence === "unmatched" })];
  });
}

function section(markdown: string, heading: string, nextHeading = "## ") {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const end = markdown.indexOf(nextHeading, start + heading.length);
  return markdown.slice(start + heading.length, end < 0 ? undefined : end);
}

function parsePrice(markdown: string, label: string) {
  const match = markdown.match(new RegExp(`\\|\\s*${label}\\s*\\|\\s*\\$([0-9.]+)\\s*\\|\\s*1M tokens\\s*\\|`, "i"));
  return match ? Number(match[1]) : undefined;
}

export function normalizeOpenAiOfficial(payload: unknown, fetchedAt: number, sourceVersion?: string): NormalizedModel[] {
  const root = record(payload);
  const privacy = record(root.privacy);
  const privacyMarkdown = text(privacy.markdown);
  const privacyUrl = text(privacy.url);
  if (!privacyMarkdown || !privacyUrl || !privacyMarkdown.includes("retained for up to 30 days") || !privacyMarkdown.includes("not used to train")) throw new Error("OpenAI privacy documentation did not contain the expected data-control statements");

  return list(root.models).map(record).flatMap((item) => {
    const markdown = text(item.markdown);
    const sourceUrl = text(item.url);
    if (!markdown || !sourceUrl) return [];
    const modelId = markdown.match(/Model ID:\s*`([^`]+)`/)?.[1];
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
    if (!modelId || !heading) throw new Error(`OpenAI model documentation at ${sourceUrl} is missing its model ID or title`);
    const identity = resolveCanonicalIdentity("openai_official", modelId, heading);
    if (!identity) return [];
    const contextWindow = number(markdown.match(/-\s*([0-9,]+) context window/i)?.[1]?.replace(/,/g, ""));
    const inputModalities = markdown.match(/- Input modalities:\s*([^\n]+)/i)?.[1]?.split(",").map((value) => value.trim()) ?? [];
    const outputModalities = markdown.match(/- Output modalities:\s*([^\n]+)/i)?.[1]?.split(",").map((value) => value.trim()) ?? [];
    const featureSection = section(markdown, "## Supported features");
    const capabilities = [...featureSection.matchAll(/^-\s+([a-z0-9_ -]+)$/gim)].map((match) => match[1].trim());
    const prices: NormalizedPrice[] = [];
    const input = parsePrice(markdown, "Input");
    const cachedInput = parsePrice(markdown, "Cached input");
    const output = parsePrice(markdown, "Output");
    for (const [pricingType, amount] of [["input_tokens", input], ["cached_input_tokens", cachedInput], ["output_tokens", output]] as const) {
      if (amount !== undefined) prices.push({ pricingType, amount, unit: "1m_tokens", currency: "USD", sourceUrl: sourceUrl.replace(/\.md$/, ""), modelVersion: modelId, sourceVersion, confidence: "official_provider_docs", effectiveAt: fetchedAt });
    }
    if (!contextWindow || input === undefined || output === undefined) throw new Error(`OpenAI model documentation at ${sourceUrl} is missing required context or pricing fields`);
    return [pendingModel(identity, {
      modalities: unique([...inputModalities, ...outputModalities]),
      capabilities,
      contextWindow,
      prices,
      privacy: [{ level: "standard", sourceUrl: privacyUrl.replace(/\.md$/, ""), confidence: "official_provider_docs", notes: "API data is not used for training by default. Abuse-monitoring logs may retain customer content for up to 30 days; approved customers may configure additional controls." }],
    })];
  });
}
