import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtificialAnalysisAdapter, OfficialProductsAdapter, OpenRouterAdapter, parseArtificialAnalysisPublicPages } from "@/lib/model-data/adapters";
import { normalizeArtificialAnalysis, normalizeMmluPro, normalizeOfficialProducts, normalizeOpenAiOfficial, normalizeOpenAsr, normalizeOpenRouter } from "@/lib/model-data/normalizers";
import { OFFICIAL_AI_PRODUCTS } from "@/lib/model-data/product-catalog";

afterEach(() => vi.unstubAllGlobals());

describe("official source adapters", () => {
  it("uses the Artificial Analysis key and free-tier endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await new ArtificialAnalysisAdapter("key").fetchSnapshot();
    const apiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/language/models/free"));
    expect(apiCall?.[1].headers["x-api-key"]).toBe("key");
  });

  it("uses public language, image, and video datasets without a paid key", async () => {
    const dataset = (name: string, data: unknown[]) => `<script type="application/ld+json">${JSON.stringify({ name, data })}</script>`;
    const language = [
      dataset("Artificial Analysis Intelligence Index", [{ label: "Gemini 3.5 Flash-Lite", intelligenceIndex: 50, detailsUrl: "/models/gemini-3-5-flash-lite" }]),
      dataset("Pricing: Cache Hit, Input, and Output", [{ label: "Gemini 3.5 Flash-Lite", pricing: [{ name: "inputPrice", value: .1 }, { name: "outputPrice", value: .4 }], detailsUrl: "/models/gemini-3-5-flash-lite" }]),
      dataset("Context Window", [{ label: "Gemini 3.5 Flash-Lite", contextWindowTokens: 1000000, detailsUrl: "/models/gemini-3-5-flash-lite" }]),
    ].join("");
    const image = [dataset("Image Arena Quality Elo", [{ label: "GPT Image", elo: [{ name: "mid", value: 1200 }], detailsUrl: "/image/model-families/openai-gpt" }]), dataset("Price ($/1k images)", [{ label: "GPT Image", price: 40 }])].join("");
    const video = [dataset("Video Arena Quality Elo", [{ label: "Veo", elo: [{ name: "mid", value: 1300 }], detailsUrl: "/video/model-families/google-veo" }]), dataset("Price ($/min)", [{ label: "Veo", price: 6 }])].join("");
    const parsed = parseArtificialAnalysisPublicPages(language, image, video);
    expect(parsed.data[0]).toMatchObject({ slug: "gemini-3-5-flash-lite", context_window_tokens: 1000000 });
    expect(parsed.imageModels[0]).toMatchObject({ name: "GPT Image", price: 40 });
    expect(parsed.videoModels[0]).toMatchObject({ name: "Veo", price: 6 });
  });

  it("extracts text-to-speech quality, price, and speed from the public dataset", () => {
    const dataset = (name: string, data: unknown[]) => `<script type="application/ld+json">${JSON.stringify({ name, data })}</script>`;
    const speech = [
      dataset("Provider Voice Arena Quality Elo", [{ label: "Gemini 3.1 Flash TTS", qualityElo: 1210, detailsUrl: "/text-to-speech/providers/gemini-3-1-tts" }, { label: "Fish Audio S2 Pro", qualityElo: 1100, detailsUrl: "/text-to-speech/providers/s2-pro" }]),
      dataset("Price", [{ label: "Gemini 3.1 Flash TTS, Google", pricePer1mCharacters: 18.3, detailsUrl: "/text-to-speech/models/gemini-3-1-tts" }]),
      dataset("Characters Per Second", [{ label: "Gemini 3.1 Flash TTS, Google", charactersPerSecond: 100, detailsUrl: "/text-to-speech/providers/gemini-3-1-tts" }]),
    ].join("");
    const parsed = parseArtificialAnalysisPublicPages("", "", "", speech);
    expect(parsed.textToSpeechModels[0]).toMatchObject({ name: "Gemini 3.1 Flash TTS", provider: "Google", qualityElo: 1210, normalizedQuality: 100, pricePer1mCharacters: 18.3, charactersPerSecond: 100 });
  });

  it("supports OpenRouter's public models endpoint and optional authentication", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await new OpenRouterAdapter().fetchSnapshot();
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe("BENCHFLOW/1.0 evidence-sync");
    await new OpenRouterAdapter("key").fetchSnapshot();
    const authenticatedCall = fetchMock.mock.calls.find((call) => call[1].headers.Authorization === "Bearer key");
    expect(authenticatedCall?.[0]).toContain("output_modalities=all");
  });

  it("checks each AI product against its official provider page", async () => {
    const allTerms = OFFICIAL_AI_PRODUCTS.flatMap((product) => product.verificationTerms).join(" ");
    const fetchMock = vi.fn().mockResolvedValue(new Response(allTerms, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await new OfficialProductsAdapter().fetchSnapshot();
    expect(snapshot.source).toBe("official_products");
    expect((snapshot.payload as { products: unknown[] }).products).toHaveLength(OFFICIAL_AI_PRODUCTS.length);
    expect(fetchMock).toHaveBeenCalledTimes(OFFICIAL_AI_PRODUCTS.length);
  });
});

describe("source normalizers", () => {
  it("normalizes verified AI products as capability evidence without inventing benchmark scores", () => {
    const products = OFFICIAL_AI_PRODUCTS.map((product) => ({ id: product.id, ok: true, matchedTerms: product.verificationTerms }));
    const models = normalizeOfficialProducts({ products }, 100);
    const codex = models.find((candidate) => candidate.canonicalId === "openai/codex-product");
    const elicit = models.find((candidate) => candidate.canonicalId === "elicit/elicit-product");
    const deepl = models.find((candidate) => candidate.canonicalId === "deepl/deepl-translator");
    expect(models).toHaveLength(OFFICIAL_AI_PRODUCTS.length);
    expect(codex).toMatchObject({ status: "eligible", capabilities: expect.arrayContaining(["repository_editing", "test_generation"]), benchmarks: [] });
    expect(codex?.capabilityEvidence[0]).toMatchObject({ confidence: "official_provider_docs" });
    expect(elicit).toMatchObject({ status: "eligible", capabilities: expect.arrayContaining(["web_research", "citation_support", "long_context"]) });
    expect(deepl).toMatchObject({ status: "eligible", capabilities: expect.arrayContaining(["translation", "document_parsing", "long_context"]) });
  });

  it("fails closed when an official product page no longer confirms its expected terms", () => {
    expect(normalizeOfficialProducts({ products: [{ id: "openai/codex-product", ok: true, matchedTerms: [] }] }, 100)).toEqual([]);
  });

  it("normalizes only present Artificial Analysis and OpenRouter values", () => {
    const aa = normalizeArtificialAnalysis({ data: [{ name: "GPT-4o", slug: "gpt-4o", model_creator: { name: "OpenAI" }, evaluations: { artificial_analysis_intelligence_index: 42 }, pricing: { price_1m_input_tokens: 1 } }] }, 100);
    expect(aa[0].benchmarks[0].score).toBe(42);
    expect(aa[0]).toMatchObject({ aiFirstClass: "AI_NATIVE", aiContributionLevel: "HIGH", automationLevel: "HIGH" });
    expect(aa[0].prices).toHaveLength(1);
    const openRouter = normalizeOpenRouter({ data: [{ id: "lab/model", name: "Model", context_length: 1000, pricing: { prompt: "0.000001" }, architecture: { input_modalities: ["text"] } }] }, 100);
    expect(openRouter[0].prices[0].amount).toBe(1);
    expect(openRouter[0].accessOptions[0]).toMatchObject({ modelId: "lab/model", url: "https://openrouter.ai/lab/model" });
    expect(openRouter[0].accessOptions[0]).toMatchObject({ aiFirstClass: "AI_CENTRIC", aiContributionLevel: "HIGH", automationLevel: "HIGH" });
  });

  it("merges newly scanned benchmark aliases into their verified catalog models", () => {
    const rows = [
      { name: "gpt-oss-120b (high)", slug: "gpt-oss-120b" },
      { name: "Nemotron 3 Super", slug: "nvidia-nemotron-3-super-120b-a12b" },
      { name: "Claude 4.5 Haiku", slug: "claude-4.5-haiku-reasoning" },
    ].map((item) => ({ ...item, evaluations: { artificial_analysis_intelligence_index: 80 }, pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 2 } }));
    expect(normalizeArtificialAnalysis({ data: rows }, 100).map((item) => item.canonicalId)).toEqual([
      "openai/gpt-oss-120b",
      "nvidia/nemotron-3-super-120b-a12b",
      "anthropic/claude-haiku-4.5",
    ]);
  });

  it("normalizes public image and video benchmarks with their published prices", () => {
    const models = normalizeArtificialAnalysis({ imageModels: [{ name: "GPT Image", sourcePath: "/image/model-families/openai-gpt", qualityElo: 1200, normalizedQuality: 100, price: 40 }], videoModels: [{ name: "Veo", sourcePath: "/video/model-families/google-veo", qualityElo: 1300, normalizedQuality: 100, price: 6 }] }, 100);
    expect(models[0]).toMatchObject({ modalities: ["text", "image"], capabilities: ["image_generation"] });
    expect(models[0].prices[0]).toMatchObject({ pricingType: "image_generation", amount: 40, unit: "1k_images" });
    expect(models[1].benchmarks[0]).toMatchObject({ category: "video", normalizedValue: 100 });
  });

  it("normalizes OpenRouter's complete catalog capabilities, prices, and published benchmarks", () => {
    const [model] = normalizeOpenRouter({
      data: [{ id: "lab/image-model", name: "Lab: Image Model", created: 100, context_length: 1000, architecture: { input_modalities: ["text"], output_modalities: ["image"] }, pricing: { prompt: "0", completion: "0" }, supported_parameters: [], benchmarks: { artificial_analysis: { intelligence_index: 60, coding_index: 70 } } }],
      imageModels: [{ id: "lab/image-model", endpointDetails: { endpoints: [{ pricing: [{ billable: "output_image", unit: "image", cost_usd: .04 }] }] } }],
    }, 200);
    expect(model.capabilities).toContain("image_generation");
    expect(model.prices).toContainEqual(expect.objectContaining({ pricingType: "image_generation", amount: 40 }));
    expect(model.benchmarks.map((item) => item.metric)).toContain("openrouter_artificial_analysis_intelligence_index");
  });

  it("normalizes speech pricing using the modality's published billing unit", () => {
    const [transcriber] = normalizeOpenRouter({ data: [{ id: "openai/whisper-large-v3", architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] }, pricing: { prompt: "0.0001", completion: "0" } }] }, 100);
    const [speaker] = normalizeOpenRouter({ data: [{ id: "fish-audio/s1", architecture: { input_modalities: ["text"], output_modalities: ["speech"] }, pricing: { prompt: "0.000015", completion: "0" } }] }, 100);
    expect(transcriber.prices).toContainEqual(expect.objectContaining({ pricingType: "speech_transcription", amount: .006, unit: "minute" }));
    expect(speaker.prices).toContainEqual(expect.objectContaining({ pricingType: "speech_generation", amount: 15, unit: "1m_characters" }));
  });

  it("normalizes an explicitly mapped Artificial Analysis TTS model", () => {
    const [model] = normalizeArtificialAnalysis({ textToSpeechModels: [{ name: "Gemini 3.1 Flash TTS", sourcePath: "/text-to-speech/providers/gemini-3-1-tts", qualityElo: 1210, normalizedQuality: 95, pricePer1mCharacters: 18.3, charactersPerSecond: 100 }] }, 100);
    expect(model).toMatchObject({ canonicalId: "google/gemini-3.1-flash-tts-preview", capabilities: ["text_to_speech"] });
    expect(model.benchmarks[0]).toMatchObject({ category: "audio", normalizedValue: 95 });
    expect(model.prices[0]).toMatchObject({ pricingType: "speech_generation", amount: 18.3, unit: "1m_characters" });
  });

  it("normalizes Open ASR WER as exact task evidence without inventing access", () => {
    const csv = "model,avg cleaned,avg original,RTFx,License\nopenai/whisper-large-v3,6.5,7.3,462.2,apache-2.0\nopenai/whisper-large-v3-turbo,7.0,7.8,782.5,mit\n";
    const models = normalizeOpenAsr(csv, 100, "revision-1");
    expect(models[0]).toMatchObject({ canonicalId: "openai/whisper-large-v3", capabilities: ["speech_to_text"], accessOptions: [] });
    expect(models[0].benchmarks[0]).toMatchObject({ category: "transcription", score: 6.5, normalizedValue: 100, sourceVersion: "revision-1" });
    expect(models[1].benchmarks[0].normalizedValue).toBe(40);
  });

  it("only exposes a Google media model when the live Gemini catalog confirms its API id", () => {
    const [model] = normalizeArtificialAnalysis({ googleModels: [{ name: "models/gemini-3.1-flash-lite-image" }], imageModels: [{ name: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)", sourcePath: "/image/model-families/google-nano-banana", qualityElo: 1200, normalizedQuality: 95, price: 40 }] }, 100);
    expect(model.accessOptions[0]).toMatchObject({ label: "Open in Google AI Studio", modelId: "gemini-3.1-flash-lite-image" });
  });

  it("retains unknown benchmark identities for manual review without fuzzy merging", () => {
    const [model] = normalizeArtificialAnalysis({ data: [{ name: "Nearly GPT Four Oh", slug: "nearly-gpt" }] }, 100);
    expect(model.canonicalId).toContain("unmatched/artificial_analysis");
    expect(model.manualReviewRequired).toBe(true);
  });

  it("maps official MMLU-Pro categories and explicit GPT-4o aliases", () => {
    const csv = "Models,Data Source,Overall,Business,Law,Health,Computer Science\nGPT-4o (2024-05-13),TIGER-Lab,0.7255,0.8,0.7,0.6,0.75\n";
    const [model] = normalizeMmluPro(csv, 100, "revision-1");
    expect(model.canonicalId).toBe("openai/gpt-4o");
    expect(model.mappingConfidence).toBe("explicit_alias");
    expect(model.benchmarks.find((item) => item.category === "legal")?.normalizedValue).toBe(70);
    expect(model.benchmarks.every((item) => item.sourceVersion === "revision-1")).toBe(true);
  });

  it("fails closed on malformed MMLU-Pro CSV", () => {
    expect(() => normalizeMmluPro("Name,Score\nModel,1\n", 100)).toThrow("missing required Models or Overall");
  });

  it("leaves a missing trailing official CSV category unavailable without shifting columns", () => {
    const [model] = normalizeMmluPro("Models,Data Source,Overall,Business,Other\nUnknown,TIGER-Lab,0.5,0.7\n", 100);
    expect(model.benchmarks.find((item) => item.metric === "mmlu_pro_business")?.normalizedValue).toBe(70);
    expect(model.benchmarks.some((item) => item.metric === "mmlu_pro_other")).toBe(false);
  });

  it("extracts exact pricing, context, capabilities, and privacy from OpenAI docs", () => {
    const markdown = "# GPT-4o\n\nModel ID: `gpt-4o`\n\n## Model details\n- Input modalities: text, image\n- Output modalities: text\n- 128,000 context window\n\n## Pricing\n| Metric | Price | Unit |\n| --- | ---: | --- |\n| Input | $2.5 | 1M tokens |\n| Cached input | $1.25 | 1M tokens |\n| Output | $10 | 1M tokens |\n\n## Supported features\n- structured_outputs\n- function_calling\n\n## Supported tools\n";
    const privacy = "API data is not used to train or improve models. Abuse monitoring logs are retained for up to 30 days.";
    const [model] = normalizeOpenAiOfficial({ models: [{ url: "https://developers.openai.com/api/docs/models/gpt-4o.md", markdown }], privacy: { url: "https://developers.openai.com/api/docs/guides/your-data.md", markdown: privacy } }, 100);
    expect(model.contextWindow).toBe(128000);
    expect(model.prices.map((item) => item.amount)).toEqual([2.5, 1.25, 10]);
    expect(model.capabilities).toContain("structured_outputs");
    expect(model.privacy[0].level).toBe("standard");
    expect(model.licenses).toEqual([]);
  });

  it("fails closed when provider documentation loses required fields", () => {
    expect(() => normalizeOpenAiOfficial({ models: [{ url: "https://example.test/model.md", markdown: "# Model" }], privacy: { url: "https://example.test/privacy.md", markdown: "changed" } }, 100)).toThrow("expected data-control statements");
  });
});
