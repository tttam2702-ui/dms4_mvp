import { describe, expect, it } from "vitest";
import { estimateStepCost, generateStrategyPlan, getExclusionReasons, isMateriallyBetter, planImprovementReasons, priorityWeights, recommendStep, scoreCandidate, selectTaskEvidence, taskCategory } from "@/lib/recommendation/engine";
import { MONTHLY_FREQUENCY_MULTIPLIERS } from "@/lib/recommendation/config";
import { affectedTaskCategories, effectiveModelCapabilities } from "@/lib/recommendation/taxonomy";
import { aiAccessMetadata } from "@/lib/recommendation/ai-first";
import type { WorkflowStep, Priority } from "@/lib/planner/schema";
import type { CanonicalModel, EvidenceReference } from "@/lib/recommendation/types";

const now = 2_000_000_000_000;
const step: WorkflowStep = { id: "s1", order: 0, name: "Write", plainLanguageDescription: "Write copy", inputDescription: "Brief", outputDescription: "Copy", dependencies: [], canRunInParallel: false, estimatedInputTokensLow: 500, estimatedInputTokensExpected: 1000, estimatedInputTokensHigh: 1500, estimatedOutputTokensLow: 300, estimatedOutputTokensExpected: 500, estimatedOutputTokensHigh: 800, estimatedRequestCount: 10, estimatedImageCount: 0, estimatedAudioMinutes: 0, estimatedVideoMinutes: 0, requiredModalities: ["text"], requiredCapabilities: ["structured_outputs"], requiresCurrentInformation: false, privacyRequirement: "business", commercialUseRequired: true, minimumQuality: "professional", importance: "high", noAIEligible: false, noAIAlternative: "Write manually", humanReviewRecommended: true, assumptions: [] };
const preferenceEvidence: EvidenceReference = { kind: "benchmark", source: "LMArena", sourceUrl: "https://lmarena.ai/leaderboard", retrievedAt: now, modelVersion: "measured-v1", metricName: "arena_preference", rawValue: 75, normalizedValue: 75, category: "preference", confidence: "official_dataset", notes: null };
const pricingEvidence: EvidenceReference = { kind: "pricing", source: "Provider pricing", sourceUrl: "https://provider.example/pricing", retrievedAt: now, modelVersion: "measured-v1", metricName: "input_tokens", rawValue: 1, normalizedValue: null, category: "cost", confidence: "official_api", notes: null };
const aiFirst = { aiFirstClass: "AI_NATIVE" as const, aiRole: "Generates the requested output", aiContributionLevel: "HIGH" as const, automationLevel: "HIGH" as const, requiredManualWork: "Review and refinement" };
const model: CanonicalModel = { ...aiFirst, id: "m1", canonicalId: "provider/measured-model", name: "Measured model", provider: "Provider", active: true, modalities: ["text"], capabilities: ["structured_outputs"], contextWindow: 100000, inputPricePerMillion: 1, outputPricePerMillion: 4, qualityScore: 75, outputTokensPerSecond: 100, privacyLevel: "business", commercialUse: true, regions: ["global"], source: "LMArena", measuredAt: now, retrievedAt: now, existingTool: false, evidence: [preferenceEvidence, pricingEvidence], accessOptions: [{ ...aiFirst, label: "Open model", url: "https://provider.example/model", modelId: "measured-model", sourceUrl: "https://provider.example/catalog", verifiedAt: now }] };
const priorities: Priority[] = ["balanced", "lowest_cost", "highest_quality", "fastest", "privacy", "existing_tools"];
const context = { priorities, budgetUsd: 10, region: "global", now, existingTools: [] };

describe("deterministic recommendation engine", () => {
  it("converts priority ranking into normalized weights", () => expect(Object.values(priorityWeights(priorities)).reduce((a, b) => a + b, 0)).toBeCloseTo(1));
  it("estimates cost from expected workload", () => expect(estimateStepCost(step, model)).toBeCloseTo(.03));
  it("hard-excludes a wrong modality", () => expect(getExclusionReasons({ ...step, requiredModalities: ["image"] }, model, context)).toContain("Missing image support"));
  it("hard-excludes missing task evidence while keeping unknown business privacy visible as a limitation", () => { const reasons = getExclusionReasons(step, { ...model, evidence: [], privacyLevel: null }, context); expect(reasons).not.toContain("Critical privacy evidence is unavailable"); expect(reasons).toContain("No general_writing performance evidence is available"); });
  it("still fails closed when sensitive work has no verified privacy evidence", () => expect(getExclusionReasons({ ...step, privacyRequirement: "sensitive" }, { ...model, privacyLevel: null }, context)).toContain("Critical privacy evidence is unavailable"));
  it("uses an exact custom budget as a hard eligibility limit", () => expect(getExclusionReasons(step, model, { ...context, budgetUsd: 0.01 })).toContain("Estimated step cost exceeds the remaining budget"));
  it("excludes catalog rows that have no verified place to use the model", () => expect(getExclusionReasons(step, { ...model, accessOptions: [] }, context)).toContain("No verified access path is available"));
  it("excludes AI-assisted and traditional products from primary recommendations", () => {
    const assisted = { ...model, aiFirstClass: "AI_ASSISTED" as const, aiContributionLevel: "MEDIUM" as const, automationLevel: "MEDIUM" as const, accessOptions: model.accessOptions!.map((access) => ({ ...access, aiFirstClass: "AI_ASSISTED" as const, aiContributionLevel: "MEDIUM" as const, automationLevel: "MEDIUM" as const })) };
    expect(getExclusionReasons(step, assisted, context)).toContain("Product is not AI-first enough to be a primary recommendation");
    expect(recommendStep(step, [assisted], context).selected).toBeNull();
  });
  it("classifies known conventional creative software as traditional during legacy migration", () => {
    expect(aiAccessMetadata("Adobe Premiere Pro", "product")).toMatchObject({ aiFirstClass: "TRADITIONAL", aiContributionLevel: "LOW", automationLevel: "LOW" });
    expect(aiAccessMetadata("DaVinci Resolve", "product").requiredManualWork).toContain("manually");
  });
  it("does not use a traditional product to fill a combination capability gap", () => {
    const researchEvidence = { ...preferenceEvidence, category: "research", metricName: "research_quality" };
    const researchStep = { ...step, name: "Research with citations", plainLanguageDescription: "Research current sources and cite them", requiredCapabilities: ["web_research", "citation_support", "reasoning"], requiresCurrentInformation: true, minimumQuality: "good" as const };
    const retrieval = { ...model, id: "retrieval", capabilities: ["web_research", "citation_support"], evidence: [researchEvidence, pricingEvidence] };
    const traditional = { ...model, id: "traditional", name: "Traditional Research Software", capabilities: ["reasoning"], evidence: [researchEvidence, pricingEvidence], aiFirstClass: "TRADITIONAL" as const, aiContributionLevel: "LOW" as const, automationLevel: "LOW" as const, accessOptions: model.accessOptions!.map((access) => ({ ...access, aiFirstClass: "TRADITIONAL" as const, aiContributionLevel: "LOW" as const, automationLevel: "LOW" as const })) };
    const recommendation = recommendStep(researchStep, [retrieval, traditional], context);
    expect(recommendation.selected).toBeNull();
    expect(recommendation.partialOptions[0].model.id).toBe("retrieval");
  });
  it("normalizes live catalog parameters into recommendation capabilities", () => {
    const capabilities = effectiveModelCapabilities({ capabilities: ["tools", "web_search_options", "file_search", "image_input", "reasoning_effort"], modalities: ["text"], contextWindow: 100000, evidence: [] });
    expect(capabilities).toEqual(expect.arrayContaining(["tool_use", "web_research", "document_parsing", "image_understanding", "reasoning"]));
  });
  it("validates each combination tool against evidence for its own role", () => {
    const uiEvidence = { ...preferenceEvidence, category: "ui_ux_design", metricName: "design_arena" };
    const imageEvidence = { ...preferenceEvidence, category: "image", metricName: "image_arena" };
    const designStep = { ...step, name: "Create a landing page and marketing visual", plainLanguageDescription: "Generate the UI and hero image", requiredModalities: ["text", "image"] as WorkflowStep["requiredModalities"], requiredCapabilities: ["ui_generation", "image_generation"], minimumQuality: "good" as const };
    const ui = { ...model, id: "ui", capabilities: ["ui_generation"], evidence: [uiEvidence, pricingEvidence] };
    const image = { ...model, id: "image", capabilities: ["image_generation"], modalities: ["text", "image"], imagePricePerThousand: 30, evidence: [imageEvidence, pricingEvidence] };
    const recommendation = recommendStep(designStep, [ui, image], context);
    expect(recommendation.selected?.kind).toBe("combination");
    expect(recommendation.selected?.tools.map((tool) => tool.model.id)).toEqual(expect.arrayContaining(["ui", "image"]));
  });
  it("prefers task-specific evidence without averaging unrelated metrics", () => { const coding = { ...preferenceEvidence, metricName: "SWE-bench Verified", category: "coding", normalizedValue: 88 }; const codingStep = { ...step, name: "Debug software", plainLanguageDescription: "Fix code" }; expect(selectTaskEvidence(codingStep, { ...model, evidence: [preferenceEvidence, coding] })?.metricName).toBe("SWE-bench Verified"); });
  it("attributes sources and explains the cost calculation", () => { const scored = scoreCandidate(step, model, context); expect(scored.evidence.map((item) => item.sourceUrl)).toContain("https://lmarena.ai/leaderboard"); expect(scored.costBasis).toContain("input"); expect(scored.roundedScore % 5).toBe(0); });
  it("uses an existing subscription at zero marginal cost", () => expect(estimateStepCost(step, { ...model, existingTool: true })).toBe(0));
  it("estimates image and video generation from published media units", () => {
    expect(estimateStepCost({ ...step, estimatedImageCount: 10, requiredCapabilities: ["image_generation"] }, { ...model, capabilities: ["image_generation"], imagePricePerThousand: 40 })).toBeCloseTo(.4);
    expect(estimateStepCost({ ...step, estimatedVideoMinutes: 1.5, requiredCapabilities: ["video_generation"] }, { ...model, capabilities: ["video_generation"], videoPricePerMinute: 6 })).toBeCloseTo(9);
    expect(estimateStepCost({ ...step, estimatedAudioMinutes: 3, requiredCapabilities: ["speech_to_text"] }, { ...model, capabilities: ["speech_to_text"], audioPricePerMinute: .01 })).toBeCloseTo(.03);
    expect(estimateStepCost({ ...step, estimatedInputTokensExpected: 1000, estimatedRequestCount: 2, requiredCapabilities: ["text_to_speech"] }, { ...model, capabilities: ["text_to_speech"], speechPricePerMillionCharacters: 15 })).toBeCloseTo(.12);
  });
  it("keeps matching subscriptions and identifies cancellable ones", () => { const plan = generateStrategyPlan([step], [{ ...model, existingTool: true }], { ...context, existingTools: ["Provider", "Unused tool"] }, "recommended"); expect(plan.existingSubscriptions.kept).toContain("Provider"); expect(plan.existingSubscriptions.couldCancel).toContain("Unused tool"); });
  it("detects a genuinely better replacement", () => { const current = scoreCandidate(step, model, context); const candidate = { ...current, roundedScore: current.roundedScore + 10 }; expect(isMateriallyBetter(current, candidate)).toBe(true); });
  it("classifies regulated and specialist tasks deterministically", () => { expect(taskCategory({ ...step, name: "Review a commercial contract", plainLanguageDescription: "Legal compliance" })).toBe("legal"); expect(taskCategory({ ...step, name: "Analyse patient notes", plainLanguageDescription: "Clinical health summary" })).toBe("healthcare"); });
  it("does not mistake concept development for software development", () => expect(taskCategory({ ...step, name: "Concept Development and Scriptwriting", plainLanguageDescription: "Develop the core storyline and write a film script", outputDescription: "Final script" })).toBe("general_writing"));
  it("recognizes storyboard creation as image-generation work", () => expect(taskCategory({ ...step, name: "Storyboard and Visual Style Guide Creation", plainLanguageDescription: "Create storyboard panels", outputDescription: "Visual storyboard", requiredModalities: ["text", "image"], requiredCapabilities: ["visual design", "storyboarding"] })).toBe("image_generation"));
  it("does not substitute general reasoning for long-document evidence", () => { const longStep = { ...step, name: "Summarise a long document", plainLanguageDescription: "Read a book with many pages" }; expect(selectTaskEvidence(longStep, model)).toBeNull(); });
  it("keeps auditable monthly workload multipliers in configuration", () => expect(MONTHLY_FREQUENCY_MULTIPLIERS.daily).toBe(22));
  it("labels thin evidence without fabricated percentages", () => expect(scoreCandidate(step, { ...model, inputPricePerMillion: null, outputPricePerMillion: null, privacyLevel: null, commercialUse: null, outputTokensPerSecond: null, mappingConfidence: "exact" }, context).evidenceConfidence).toBe("Limited"));
  it("prefers a complete single tool before considering combinations", () => {
    const translationEvidence = { ...preferenceEvidence, category: "translation", metricName: "multilingual_quality" };
    const translationStep = { ...step, name: "Translate documentation", plainLanguageDescription: "Translate technical documentation", requiredCapabilities: ["translation", "reasoning"], minimumQuality: "good" as const };
    const allInOne = { ...model, id: "all", name: "All in one", capabilities: ["translation", "reasoning"], evidence: [translationEvidence, pricingEvidence] };
    const translator = { ...model, id: "translator", name: "Translator", capabilities: ["translation"], evidence: [translationEvidence, pricingEvidence] };
    const reasoner = { ...model, id: "reasoner", name: "Reasoner", capabilities: ["reasoning"], evidence: [translationEvidence, pricingEvidence] };
    const recommendation = recommendStep(translationStep, [translator, reasoner, allInOne], context);
    expect(recommendation.selected?.kind).toBe("single");
    expect(recommendation.selected?.model.id).toBe("all");
  });
  it("uses the smallest complete combination only when no single tool qualifies", () => {
    const researchEvidence = { ...preferenceEvidence, category: "research", metricName: "research_quality" };
    const researchStep = { ...step, name: "Research with citations", plainLanguageDescription: "Research current sources and cite them", requiresCurrentInformation: true, requiredCapabilities: ["web_research", "citation_support", "reasoning"], minimumQuality: "good" as const };
    const retrieval = { ...model, id: "retrieval", name: "Research search", capabilities: ["web_research", "citation_support"], evidence: [researchEvidence, pricingEvidence] };
    const reasoner = { ...model, id: "reasoner", name: "Research reasoner", capabilities: ["reasoning"], evidence: [researchEvidence, pricingEvidence] };
    const extra = { ...model, id: "extra", name: "Extra writer", capabilities: ["text_generation"], evidence: [researchEvidence, pricingEvidence] };
    const recommendation = recommendStep(researchStep, [retrieval, reasoner, extra], context);
    expect(recommendation.selected?.kind).toBe("combination");
    expect(recommendation.selected?.tools).toHaveLength(2);
    expect(recommendation.selected?.missingCapabilities).toEqual([]);
  });
  it("labels incomplete coverage without selecting it as a complete answer", () => {
    const researchEvidence = { ...preferenceEvidence, category: "research", metricName: "research_quality" };
    const researchStep = { ...step, name: "Research with citations", plainLanguageDescription: "Research and cite current sources", requiresCurrentInformation: true, requiredCapabilities: ["web_research", "citation_support", "reasoning"], minimumQuality: "good" as const };
    const retrieval = { ...model, id: "retrieval", capabilities: ["web_research"], evidence: [researchEvidence, pricingEvidence] };
    const recommendation = recommendStep(researchStep, [retrieval], context);
    expect(recommendation.selected).toBeNull();
    expect(recommendation.partialOptions[0].kind).toBe("partial");
    expect(recommendation.partialOptions[0].missingCapabilities).toContain("citation_support");
  });
  it("counts one product subscription once when it is reused across steps", () => {
    const subscribed = { ...model, accessOptions: [{ ...model.accessOptions![0], productId: "provider-suite", productName: "Provider Suite", planName: "Plus", accessMethod: "product" as const, monthlyPriceUsd: 20 }] };
    const plan = generateStrategyPlan([step, { ...step, id: "s2", order: 1, name: "Rewrite" }], [subscribed], { ...context, budgetUsd: 100 }, "recommended");
    expect(plan.subscriptions).toHaveLength(1);
    expect(plan.fixedCostUsd).toBe(20);
    expect(plan.subscriptions[0].stepIds).toEqual(["s1", "s2"]);
  });
  it("recommends Codex from official capability evidence without pretending it has a benchmark score", () => {
    const codingStep = { ...step, name: "Backend and bot integration coding", plainLanguageDescription: "Implement backend services in the repository and generate automated tests", requiredCapabilities: ["coding", "repository_editing", "test_generation"], minimumQuality: "good" as const };
    const capabilityEvidence: EvidenceReference = { kind: "capability", source: "Official product documentation", sourceUrl: "https://developers.openai.com/", retrievedAt: now, modelVersion: "openai/codex-product", metricName: "official_product_capabilities", rawValue: ["coding", "repository_editing", "test_generation", "agentic_execution", "tool_use"], normalizedValue: null, category: "software_engineering", confidence: "official_provider_docs", notes: "Capability evidence, not a performance benchmark." };
    const codex: CanonicalModel = {
      ...model,
      id: "codex",
      canonicalId: "openai/codex-product",
      name: "OpenAI Codex",
      provider: "OpenAI",
      capabilities: ["coding", "repository_editing", "test_generation", "agentic_execution", "tool_use"],
      contextWindow: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      qualityScore: null,
      evidence: [capabilityEvidence],
      accessOptions: [{ ...aiFirst, label: "Open Codex", url: "https://chatgpt.com/codex", modelId: "openai/codex-product", sourceUrl: "https://developers.openai.com/", verifiedAt: now, productId: "openai/codex-product", productName: "OpenAI Codex", planName: "ChatGPT plan or API usage", accessMethod: "product" }],
    };
    const recommendation = recommendStep(codingStep, [codex], { ...context, budgetUsd: 0, existingTools: ["OpenAI Codex"] });
    expect(recommendation.selected?.model.name).toBe("OpenAI Codex");
    expect(recommendation.selected?.evidenceConfidence).toBe("Limited");
    expect(recommendation.selected?.qualityScore).toBe(0);
  });
  it("does not recommend a subscription above the entered budget", () => {
    const subscribed = { ...model, accessOptions: [{ ...model.accessOptions![0], productId: "provider-suite", productName: "Provider Suite", planName: "Pro", accessMethod: "product" as const, monthlyPriceUsd: 20 }] };
    const plan = generateStrategyPlan([step], [subscribed], { ...context, budgetUsd: 5 }, "recommended");
    expect(plan.steps[0].selected).toBeNull();
    expect(plan.totalCostUsd).toBe(0);
    expect(plan.budgetCompatible).toBe(false);
  });
  it("rejects an unpriced new subscription when a budget was provided", () => {
    const unpriced = { ...model, accessOptions: [{ ...model.accessOptions![0], productName: "Mystery Suite", planName: "Pro", accessMethod: "product" as const }] };
    expect(getExclusionReasons(step, unpriced, context)).toContain("Subscription price is not verified, so budget compatibility cannot be confirmed");
    expect(generateStrategyPlan([step], [unpriced], context, "recommended").steps[0].selected).toBeNull();
  });
  it("enforces the budget across the complete stack, not separately per step", () => {
    const translationEvidence = { ...preferenceEvidence, category: "translation", metricName: "multilingual_quality" };
    const translationStep = { ...step, id: "s2", order: 1, name: "Translate", plainLanguageDescription: "Translate the approved copy", requiredCapabilities: ["translation"], minimumQuality: "good" as const };
    const writer = { ...model, id: "writer", accessOptions: [{ ...model.accessOptions![0], productId: "writer", productName: "Writer", accessMethod: "product" as const, monthlyPriceUsd: 6 }] };
    const translator = { ...model, id: "translator", capabilities: ["translation"], evidence: [translationEvidence, pricingEvidence], accessOptions: [{ ...model.accessOptions![0], productId: "translator", productName: "Translator", accessMethod: "product" as const, monthlyPriceUsd: 6 }] };
    const plan = generateStrategyPlan([step, translationStep], [writer, translator], { ...context, budgetUsd: 10 }, "recommended");
    expect(plan.totalCostUsd).toBeLessThanOrEqual(10);
    expect(plan.completeStepCount).toBe(1);
    expect(plan.budgetCompatible).toBe(false);
  });
  it("treats avoided providers and sensitive information as hard requirements", () => {
    expect(getExclusionReasons(step, model, { ...context, providersToAvoid: ["Provider"] })).toContain("Provider is excluded by the user's preference: Provider");
    expect(getExclusionReasons(step, { ...model, privacyLevel: "business" }, { ...context, informationSensitivity: "restricted" })).toContain("Privacy controls do not meet the requirement");
  });
  it("records every saved answer in the plan's auditable input summary", () => {
    const plan = generateStrategyPlan([step], [model], { ...context, projectDescription: "Write a launch campaign", expectedResult: "Approved copy", deadline: "2033-06-01", informationSensitivity: "business", commercialUse: true, providersToAvoid: ["Acme"], preferredLanguage: "Vietnamese", expectedOutputs: "DOCX and PDF", existingTools: ["Provider"] }, "recommended");
    expect(plan.inputsUsed).toMatchObject({ projectDescription: "Write a launch campaign", expectedResult: "Approved copy", preferredLanguage: "Vietnamese", expectedOutputs: "DOCX and PDF", providersToAvoid: ["Acme"], existingTools: ["Provider"] });
  });
  it("shows distinct products across the five user-facing option slots when alternatives exist", () => {
    const candidates = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((name, index) => ({
      ...model,
      id: `option-${index}`,
      canonicalId: `provider/option-${index}`,
      name,
      accessOptions: [{ ...model.accessOptions![0], modelId: `option-${index}`, productId: `option-${index}`, productName: name }],
    }));
    const recommendation = recommendStep(step, candidates, context);
    expect(new Set(Object.values(recommendation.options).map((option) => option?.model.name))).toEqual(new Set(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]));
  });
  it("bounds persisted eligibility diagnostics as the catalog grows", () => {
    const excludedModels = Array.from({ length: 100 }, (_, index) => ({ ...model, id: `excluded-${index}`, canonicalId: `provider/excluded-${index}`, name: `Excluded ${index}`, modalities: ["image"] }));
    expect(recommendStep(step, excludedModels, context).exclusions).toHaveLength(8);
  });
  it("re-evaluates only task categories affected by changed evidence", () => {
    const categories = affectedTaskCategories(["coding", "repository_editing", "test_generation"], ["software_engineering"]);
    expect(categories).toContain("coding");
    expect(categories).toContain("software_engineering");
    expect(categories).not.toContain("image_generation");
    expect(categories).not.toContain("video_generation");
  });
  it("does not alert for a trivial score fluctuation", () => {
    const current = generateStrategyPlan([step], [model], context, "recommended");
    const candidate = structuredClone(current);
    candidate.steps[0].selected!.roundedScore += 5;
    expect(planImprovementReasons(current, candidate)).toEqual([]);
  });
  it("creates a refresh opportunity for meaningful plan improvements", () => {
    const current = generateStrategyPlan([step], [model], context, "recommended");
    const candidate = structuredClone(current);
    candidate.steps[0].selected!.roundedScore += 10;
    candidate.totalCostUsd = Number((current.totalCostUsd * 0.8).toFixed(2));
    expect(planImprovementReasons(current, candidate)).toEqual(expect.arrayContaining(["Materially higher task-specific quality", "At least 15% lower total cost"]));
  });
});
