import type { Priority, WorkflowStep } from "@/lib/planner/schema";
import type {
  CandidateScore,
  CanonicalModel,
  EvidenceReference,
  Exclusion,
  FitLabel,
  ModelAccessOption,
  RecommendationContext,
  StepOptionSet,
  StepRecommendation,
  StrategyPlan,
  StrategyVariant,
  SubscriptionSummary,
} from "./types";
import { BASE_WEIGHTS, QUALITY_MINIMUM } from "./config";
import {
  effectiveModelCapabilities,
  evidenceCategoriesForCapabilities,
  requiredCapabilitiesForStep,
  TASK_EVIDENCE_MAP,
  taskCategory as classifyTask,
  type Capability,
  type TaskCategory,
} from "./taxonomy";
import { isAiFirstEligible } from "./ai-first";

const PRIVACY_RANK = { standard: 1, business: 2, sensitive: 3, restricted: 4 } as const;
const MAX_COMBINATION_TOOLS = 3;
const COMBINATION_POOL_LIMIT = 24;
const BEAM_WIDTH = 48;
const MAX_EXCLUSIONS_PER_STEP = 8;

function productAccess(model: CanonicalModel) {
  return model.accessOptions?.find((option) => option.accessMethod === "product");
}

function effectivePrivacyRequirement(step: WorkflowStep, context: RecommendationContext): keyof typeof PRIVACY_RANK {
  const requested = context.informationSensitivity && context.informationSensitivity in PRIVACY_RANK
    ? context.informationSensitivity as keyof typeof PRIVACY_RANK
    : "standard";
  return PRIVACY_RANK[requested] > PRIVACY_RANK[step.privacyRequirement] ? requested : step.privacyRequirement;
}

function modelIsAlreadyOwned(model: CanonicalModel, context: RecommendationContext) {
  const access = productAccess(model);
  const haystack = `${model.provider} ${model.name} ${access?.productName ?? ""} ${access?.planName ?? ""}`.toLowerCase();
  return model.existingTool || (context.existingTools ?? []).some((tool) => haystack.includes(tool.toLowerCase()));
}

function avoidedProviderMatch(model: CanonicalModel, context: RecommendationContext) {
  const haystack = `${model.provider} ${model.name} ${(model.accessOptions ?? []).map((option) => `${option.productName ?? ""} ${option.label}`).join(" ")}`.toLowerCase();
  return (context.providersToAvoid ?? []).find((provider) => provider.trim() && haystack.includes(provider.trim().toLowerCase()));
}

export function priorityWeights(priorities: Priority[]) {
  const weights: Record<keyof typeof BASE_WEIGHTS, number> = { ...BASE_WEIGHTS };
  const boosts: Record<Priority, keyof typeof weights> = { lowest_cost: "cost", balanced: "evidence", highest_quality: "performance", fastest: "speed", privacy: "privacy", existing_tools: "existing" };
  priorities.forEach((priority, index) => { weights[boosts[priority]] += Math.max(0, 10 - index * 2); });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total])) as Record<keyof typeof weights, number>;
}

function baseStepCost(step: WorkflowStep, model: CanonicalModel): number | null {
  if (productAccess(model)) return 0;
  const capabilities = effectiveModelCapabilities(model);
  if (capabilities.includes("video_generation")) {
    return model.videoPricePerMinute == null ? null : step.estimatedVideoMinutes * model.videoPricePerMinute;
  }
  if (capabilities.includes("image_generation")) {
    return model.imagePricePerThousand == null ? null : (step.estimatedImageCount / 1_000) * model.imagePricePerThousand;
  }
  if (capabilities.includes("speech_to_text")) {
    return model.audioPricePerMinute == null ? null : step.estimatedAudioMinutes * model.audioPricePerMinute;
  }
  if (capabilities.includes("text_to_speech") || capabilities.includes("audio_generation")) {
    const estimatedCharacters = step.estimatedInputTokensExpected * step.estimatedRequestCount * 4;
    return model.speechPricePerMillionCharacters == null ? null : (estimatedCharacters / 1_000_000) * model.speechPricePerMillionCharacters;
  }
  if (model.inputPricePerMillion === null || model.outputPricePerMillion === null) return null;
  const input = step.estimatedInputTokensExpected * step.estimatedRequestCount;
  const output = step.estimatedOutputTokensExpected * step.estimatedRequestCount;
  return (input / 1_000_000) * model.inputPricePerMillion + (output / 1_000_000) * model.outputPricePerMillion;
}

export function estimateStepCost(step: WorkflowStep, model: CanonicalModel): number | null {
  const cost = baseStepCost(step, model);
  return cost === null ? null : model.existingTool ? 0 : cost;
}

export function taskCategory(step: WorkflowStep): TaskCategory {
  return classifyTask(step);
}

export function selectTaskEvidence(step: WorkflowStep, model: CanonicalModel): EvidenceReference | null {
  const evidence = (model.evidence ?? []).filter((item) => (item.kind === "benchmark" || item.kind === "capability") && item.category !== "speed");
  const category = taskCategory(step);
  const accepted = TASK_EVIDENCE_MAP[category];
  return evidence
    .filter((item) => accepted.includes(item.category))
    .sort((a, b) => Number(a.kind === "capability") - Number(b.kind === "capability") || accepted.indexOf(a.category) - accepted.indexOf(b.category) || b.retrievedAt - a.retrievedAt || (b.normalizedValue ?? 0) - (a.normalizedValue ?? 0))[0] ?? null;
}

function selectCapabilityEvidence(model: CanonicalModel, capabilities: readonly Capability[]): EvidenceReference | null {
  const accepted = evidenceCategoriesForCapabilities(capabilities);
  return (model.evidence ?? [])
    .filter((item) => item.kind === "benchmark"
      ? accepted.includes(item.category)
      : item.kind === "capability" && Array.isArray(item.rawValue) && capabilities.every((capability) => (item.rawValue as unknown[]).includes(capability)))
    .sort((a, b) => Number(a.kind === "capability") - Number(b.kind === "capability") || accepted.indexOf(a.category) - accepted.indexOf(b.category) || b.retrievedAt - a.retrievedAt || (b.normalizedValue ?? 0) - (a.normalizedValue ?? 0))[0] ?? null;
}

function capabilityGaps(step: WorkflowStep, models: CanonicalModel[]) {
  const required = requiredCapabilitiesForStep(step);
  const covered = new Set(models.flatMap(effectiveModelCapabilities));
  return required.filter((capability) => !covered.has(capability));
}

function modalityGaps(step: WorkflowStep, models: CanonicalModel[]) {
  const covered = new Set(models.flatMap((model) => model.modalities));
  return step.requiredModalities.filter((modality) => !covered.has(modality));
}

function nonCoverageExclusionReasons(step: WorkflowStep, model: CanonicalModel, context: RecommendationContext, evidenceCapabilities?: Capability[]) {
  const reasons: string[] = [];
  const avoidedProvider = avoidedProviderMatch(model, context);
  if (avoidedProvider) reasons.push(`Provider is excluded by the user's preference: ${avoidedProvider}`);
  if (!model.active) reasons.push("Model is inactive");
  if (!(model.accessOptions ?? []).length) reasons.push("No verified access path is available");
  else if (!isAiFirstEligible(model) || !(model.accessOptions ?? []).some(isAiFirstEligible)) {
    reasons.push(model.aiFirstClass === "AI_ASSISTED" || model.aiFirstClass === "TRADITIONAL"
      ? "Product is not AI-first enough to be a primary recommendation"
      : "No verified AI-first access path is available");
  }
  const expectedContext = step.estimatedInputTokensHigh + step.estimatedOutputTokensHigh;
  const capabilities = effectiveModelCapabilities(model);
  const verifiedProduct = Boolean(productAccess(model));
  const mediaTool = capabilities.some((capability) => ["image_generation", "video_generation", "audio_generation", "text_to_speech", "speech_to_text", "video_editing"].includes(capability));
  if (!verifiedProduct && !mediaTool && model.contextWindow === null) reasons.push("Critical context-window evidence is unavailable");
  else if (model.contextWindow !== null && model.contextWindow < expectedContext && !capabilities.includes("document_parsing")) reasons.push("Context window is too small");
  const privacyRequirement = effectivePrivacyRequirement(step, context);
  if (model.privacyLevel === null && (privacyRequirement === "sensitive" || privacyRequirement === "restricted")) reasons.push("Critical privacy evidence is unavailable");
  else if (model.privacyLevel !== null && PRIVACY_RANK[model.privacyLevel] < PRIVACY_RANK[privacyRequirement]) reasons.push("Privacy controls do not meet the requirement");
  if ((step.commercialUseRequired || context.commercialUse === true) && model.commercialUse === false) reasons.push("Commercial use is not permitted");
  if (model.regions.length > 0 && !model.regions.includes(context.region)) reasons.push("Model is unavailable in the selected region");
  const cost = estimateStepCost(step, model);
  if (!verifiedProduct && cost === null) reasons.push("Critical pricing evidence is unavailable");
  const evidence = evidenceCapabilities?.length ? selectCapabilityEvidence(model, evidenceCapabilities) : selectTaskEvidence(step, model);
  if (!evidence) reasons.push(evidenceCapabilities?.length
    ? `No relevant performance evidence is available for ${evidenceCapabilities.join(", ")}`
    : `No ${taskCategory(step)} performance evidence is available`);
  else if (evidence.kind === "benchmark" && (evidence.normalizedValue ?? (typeof evidence.rawValue === "number" ? evidence.rawValue : 0)) < QUALITY_MINIMUM[step.minimumQuality]) reasons.push("Measured task quality is below the required level");
  return reasons;
}

export function getExclusionReasons(step: WorkflowStep, model: CanonicalModel, context: RecommendationContext): string[] {
  const reasons = nonCoverageExclusionReasons(step, model, context);
  for (const modality of modalityGaps(step, [model])) reasons.push(`Missing ${modality} support`);
  for (const capability of capabilityGaps(step, [model])) reasons.push(`Missing required capability: ${capability}`);
  const cost = estimateStepCost(step, model);
  if (cost !== null && context.budgetUsd !== null && cost > context.budgetUsd) reasons.push("Estimated step cost exceeds the remaining budget");
  const subscription = productAccess(model);
  if (context.budgetUsd !== null && subscription && !modelIsAlreadyOwned(model, context)) {
    if (subscription.monthlyPriceUsd === undefined) reasons.push("Subscription price is not verified, so budget compatibility cannot be confirmed");
    else if ((cost ?? 0) + subscription.monthlyPriceUsd > context.budgetUsd) reasons.push("Subscription plus estimated usage exceeds the total budget");
  }
  return [...new Set(reasons)];
}

function normalise(value: number | null, ceiling: number): number { return value === null ? 0 : Math.max(0, Math.min(1, value / ceiling)); }
function fitLabel(score: number, evidence: number): FitLabel { if (evidence < 0.75) return "Limited Evidence"; if (score >= 80) return "Strong Fit"; if (score >= 65) return "Good Fit"; return "Possible Fit"; }

function confidenceLabel(model: CanonicalModel, taskEvidence: EvidenceReference | null, evidenceCoverage: number, ageDays: number) {
  const relevantSources = new Set((model.evidence ?? []).filter((item) => item.kind === "benchmark" && item.category === taskEvidence?.category).map((item) => item.source));
  const officialPricing = (model.evidence ?? []).some((item) => item.kind === "pricing" && /official|provider/i.test(item.confidence));
  const officialPrivacy = (model.evidence ?? []).some((item) => item.kind === "privacy" && /official|provider/i.test(item.confidence));
  if (relevantSources.size >= 2 && officialPricing && officialPrivacy && evidenceCoverage >= 0.85 && ageDays <= 30 && model.mappingConfidence !== "unmatched") return "High" as const;
  if (taskEvidence && officialPricing && evidenceCoverage >= 0.55 && ageDays <= 90 && model.mappingConfidence !== "unmatched") return "Moderate" as const;
  return "Limited" as const;
}

function costBasis(step: WorkflowStep, model: CanonicalModel) {
  const subscription = productAccess(model);
  if (subscription) return subscription.monthlyPriceUsd === undefined
    ? `${subscription.planName ?? "Provider plan"}; current subscription price must be checked with the provider`
    : `${subscription.planName ?? "Provider plan"} at $${subscription.monthlyPriceUsd.toFixed(2)}/month, counted once across the roadmap`;
  const capabilities = effectiveModelCapabilities(model);
  if (capabilities.includes("video_generation")) return `${step.estimatedVideoMinutes} video minute${step.estimatedVideoMinutes === 1 ? "" : "s"} × $${(model.videoPricePerMinute ?? 0).toFixed(4)}/minute`;
  if (capabilities.includes("image_generation")) return `${step.estimatedImageCount} image${step.estimatedImageCount === 1 ? "" : "s"} × $${(model.imagePricePerThousand ?? 0).toFixed(2)}/1,000 images`;
  if (capabilities.includes("speech_to_text")) return `${step.estimatedAudioMinutes} audio minute${step.estimatedAudioMinutes === 1 ? "" : "s"} × $${(model.audioPricePerMinute ?? 0).toFixed(4)}/minute`;
  if (capabilities.includes("text_to_speech") || capabilities.includes("audio_generation")) {
    const estimatedCharacters = step.estimatedInputTokensExpected * step.estimatedRequestCount * 4;
    return `~${estimatedCharacters.toLocaleString("en-US")} input characters at $${(model.speechPricePerMillionCharacters ?? 0).toFixed(2)}/1M`;
  }
  const input = step.estimatedInputTokensExpected * step.estimatedRequestCount;
  const output = step.estimatedOutputTokensExpected * step.estimatedRequestCount;
  return `${input.toLocaleString("en-US")} input + ${output.toLocaleString("en-US")} output tokens at $${(model.inputPricePerMillion ?? 0).toFixed(2)}/$${(model.outputPricePerMillion ?? 0).toFixed(2)} per 1M`;
}

function accessFor(model: CanonicalModel): ModelAccessOption {
  const access = model.accessOptions?.find(isAiFirstEligible);
  if (!access) throw new Error(`No verified access option for ${model.name}`);
  return access;
}

export function scoreCandidate(step: WorkflowStep, model: CanonicalModel, context: RecommendationContext): CandidateScore {
  const cost = estimateStepCost(step, model) ?? 0;
  const fullCost = baseStepCost(step, model) ?? 0;
  const taskEvidence = selectTaskEvidence(step, model);
  const performance = taskEvidence?.normalizedValue ?? (typeof taskEvidence?.rawValue === "number" ? taskEvidence.rawValue : model.qualityScore) ?? 0;
  const capabilities = effectiveModelCapabilities(model);
  const verifiedProduct = Boolean(productAccess(model));
  const mediaGenerator = capabilities.some((capability) => ["image_generation", "video_generation", "speech_to_text", "text_to_speech", "audio_generation"].includes(capability));
  const evidenceFields = verifiedProduct
    ? [taskEvidence, model.privacyLevel, model.commercialUse]
    : mediaGenerator
    ? [model.imagePricePerThousand ?? model.videoPricePerMinute ?? model.audioPricePerMinute ?? model.speechPricePerMillionCharacters, taskEvidence, model.privacyLevel, model.commercialUse]
    : [model.contextWindow, model.inputPricePerMillion, model.outputPricePerMillion, taskEvidence, model.outputTokensPerSecond, model.privacyLevel, model.commercialUse];
  const evidenceCoverage = evidenceFields.filter((value) => value !== null && value !== undefined).length / evidenceFields.length;
  const measuredAt = taskEvidence?.retrievedAt ?? model.measuredAt;
  const ageDays = measuredAt ? Math.max(0, (context.now - measuredAt) / 86_400_000) : 365;
  const freshness = Math.max(0, 1 - ageDays / 120);
  const privacy = model.privacyLevel ? PRIVACY_RANK[model.privacyLevel] / 4 : 0;
  const weights = priorityWeights(context.priorities);
  const components = { performance: normalise(performance, 100), cost: 1 / (1 + cost), speed: normalise(model.outputTokensPerSecond, 250), privacy, commercial: model.commercialUse ? 1 : 0, existing: model.existingTool ? 1 : 0, evidence: evidenceCoverage, freshness };
  const raw = Object.entries(components).reduce((total, [key, value]) => total + value * weights[key as keyof typeof weights], 0) * 100;
  const roundedScore = Math.round(raw / 5) * 5;
  const limitations: string[] = [];
  if (evidenceCoverage < 1) limitations.push("Some comparison fields are unavailable");
  if (model.privacyLevel === null) limitations.push("Privacy terms were not verified; review the provider agreement before uploading sensitive material");
  if ((step.commercialUseRequired || context.commercialUse === true) && model.commercialUse === null) limitations.push("Commercial-use terms were not verified; review the provider agreement before publishing");
  if (ageDays > 30) limitations.push(`Task evidence is ${Math.round(ageDays)} days old`);
  const explanation = [
    taskEvidence?.kind === "capability" ? `Official product documentation verifies the capabilities needed for ${taskCategory(step)} work; comparative performance evidence remains limited` : taskEvidence ? `Uses ${taskEvidence.metricName} evidence relevant to ${taskCategory(step)} work` : "Task-specific performance evidence is limited",
    model.existingTool ? "Reuses a subscription you already pay for" : verifiedProduct ? "Subscription cost is counted once across the complete roadmap" : cost < 0.1 ? "Has a low estimated cost for this workload" : "Fits the remaining budget",
    model.privacyLevel ? `Meets the ${effectivePrivacyRequirement(step, context)} privacy requirement` : "Privacy evidence is unavailable",
    model.aiRole ?? "AI substantially produces the required output after receiving the user's inputs and instructions",
  ];
  const evidence = (model.evidence ?? []).filter((item) => item === taskEvidence || item.kind !== "benchmark" || item.category === "speed");
  const evidenceConfidence = confidenceLabel(model, taskEvidence, evidenceCoverage, ageDays);
  if (evidenceConfidence === "Limited") limitations.push("Evidence confidence is limited for this task");
  const required = requiredCapabilitiesForStep(step);
  const coveredCapabilities = required.filter((capability) => capabilities.includes(capability));
  return {
    kind: "single",
    model,
    roundedScore,
    label: fitLabel(roundedScore, evidenceCoverage),
    estimatedCostUsd: Number(cost.toFixed(4)),
    estimatedSavingsUsd: Number(Math.max(0, fullCost - cost).toFixed(4)),
    costBasis: costBasis(step, model),
    explanation,
    limitations,
    evidence,
    evidenceConfidence,
    qualityScore: performance,
    speedScore: model.outputTokensPerSecond ?? 0,
    privacyScore: privacy * 100,
    workflowFriction: 0,
    coveredCapabilities,
    missingCapabilities: required.filter((capability) => !coveredCapabilities.includes(capability)),
    tools: [{ model, access: accessFor(model), coversCapabilities: coveredCapabilities, estimatedCostUsd: Number(cost.toFixed(4)), costBasis: costBasis(step, model) }],
  };
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, selected: T[]) => {
    if (selected.length === size) { result.push(selected); return; }
    for (let index = start; index <= items.length - (size - selected.length); index += 1) walk(index + 1, [...selected, items[index]]);
  };
  walk(0, []);
  return result;
}

function coverageFor(step: WorkflowStep, model: CanonicalModel) {
  const required = requiredCapabilitiesForStep(step);
  const capabilities = effectiveModelCapabilities(model);
  return required.filter((capability) => capabilities.includes(capability));
}

function buildCombination(step: WorkflowStep, models: CanonicalModel[], context: RecommendationContext): CandidateScore | null {
  const required = requiredCapabilitiesForStep(step);
  const missingCapabilities = capabilityGaps(step, models);
  if (missingCapabilities.length || modalityGaps(step, models).length) return null;
  const costs = models.map((model) => estimateStepCost(step, model));
  if (costs.some((cost) => cost === null)) return null;
  const totalCost = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
  const subscriptions = new Map<string, number | null>();
  for (const model of models) {
    const access = productAccess(model);
    if (!access || modelIsAlreadyOwned(model, context)) continue;
    const key = `${model.provider}:${access.productId ?? access.productName ?? model.name}:${access.planName ?? "product"}`.toLowerCase();
    subscriptions.set(key, access.monthlyPriceUsd ?? null);
  }
  if (context.budgetUsd !== null && ([...subscriptions.values()].some((price) => price === null)
    || totalCost + [...subscriptions.values()].reduce<number>((sum, price) => sum + (price ?? 0), 0) > context.budgetUsd)) return null;
  const toolScores = models.map((model) => scoreCandidate(step, model, { ...context, budgetUsd: null }));
  const contributions = models.map((model) => coverageFor(step, model));
  const roleEvidence = models.map((model, index) => selectCapabilityEvidence(model, contributions[index]));
  if (roleEvidence.some((evidence) => evidence === null)) return null;
  if (contributions.some((coverage, index) => coverage.every((capability) => contributions.some((other, otherIndex) => otherIndex !== index && other.includes(capability))))) return null;
  const overlapCount = contributions.reduce((total, coverage, index) => total + coverage.filter((capability) => contributions.some((other, otherIndex) => otherIndex < index && other.includes(capability))).length, 0);
  const transferCount = Math.max(0, models.length - 1);
  const duplicateFunctionPenalty = overlapCount * 2;
  const workflowFriction = transferCount * 5 + duplicateFunctionPenalty;
  const averageScore = toolScores.reduce((sum, item) => sum + item.roundedScore, 0) / toolScores.length;
  const roundedScore = Math.max(0, Math.round((averageScore - workflowFriction) / 5) * 5);
  const sorted = models.map((model, index) => ({ model, index, coverage: contributions[index] })).sort((a, b) => b.coverage.length - a.coverage.length || a.model.name.localeCompare(b.model.name));
  const evidence = [...toolScores.flatMap((score) => score.evidence), ...roleEvidence.filter((item): item is EvidenceReference => item !== null)].filter((item, index, all) => all.findIndex((other) => other.kind === item.kind && other.metricName === item.metricName && other.source === item.source && other.modelVersion === item.modelVersion) === index);
  const confidenceOrder = { High: 3, Moderate: 2, Limited: 1 } as const;
  const evidenceConfidence = toolScores.map((score) => score.evidenceConfidence).sort((a, b) => confidenceOrder[a] - confidenceOrder[b])[0];
  const coveredCapabilities = required.filter((capability) => models.some((model) => effectiveModelCapabilities(model).includes(capability)));
  const roleSummary = sorted.map(({ model, coverage }) => `${model.name} covers ${coverage.join(", ")}`).join("; ");
  return {
    kind: "combination",
    model: sorted[0].model,
    roundedScore,
    label: fitLabel(roundedScore, evidenceConfidence === "Limited" ? 0.5 : 0.9),
    estimatedCostUsd: Number(totalCost.toFixed(4)),
    estimatedSavingsUsd: Number(toolScores.reduce((sum, score) => sum + score.estimatedSavingsUsd, 0).toFixed(4)),
    costBasis: toolScores.map((score) => `${score.model.name}: ${score.costBasis}`).join("; "),
    explanation: [
      `No single verified tool currently satisfies all ${required.length} hard capabilities for this step.`,
      `${roleSummary}.`,
      `This is the smallest verified combination found; ${transferCount} handoff${transferCount === 1 ? " is" : "s are"} required.`,
    ],
    limitations: [...new Set([...toolScores.flatMap((score) => score.limitations), `${transferCount} manual tool handoff${transferCount === 1 ? "" : "s"} may add workflow friction`])],
    evidence,
    evidenceConfidence,
    qualityScore: toolScores.reduce((sum, score) => sum + score.qualityScore, 0) / toolScores.length,
    speedScore: Math.min(...toolScores.map((score) => score.speedScore)),
    privacyScore: Math.min(...toolScores.map((score) => score.privacyScore)),
    workflowFriction,
    coveredCapabilities,
    missingCapabilities: [],
    tools: sorted.map(({ model, index, coverage }) => ({ model, access: accessFor(model), coversCapabilities: coverage, estimatedCostUsd: toolScores[index].estimatedCostUsd, costBasis: toolScores[index].costBasis })),
  };
}

function compareBestFit(a: CandidateScore, b: CandidateScore) {
  return b.roundedScore - a.roundedScore || a.tools.length - b.tools.length || a.estimatedCostUsd - b.estimatedCostUsd || a.model.name.localeCompare(b.model.name);
}

export function findCombinationCandidates(step: WorkflowStep, models: CanonicalModel[], context: RecommendationContext) {
  const base = models
    .map((model) => ({ model, covered: coverageFor(step, model) }))
    .filter((item) => item.covered.length > 0 && nonCoverageExclusionReasons(step, item.model, { ...context, budgetUsd: null }, item.covered).length === 0)
    .map(({ model, covered }) => ({ model, coverage: covered.length, score: scoreCandidate(step, model, { ...context, budgetUsd: null }).roundedScore }))
    .sort((a, b) => b.coverage - a.coverage || b.score - a.score)
    .slice(0, COMBINATION_POOL_LIMIT)
    .map((item) => item.model);
  for (let size = 2; size <= MAX_COMBINATION_TOOLS; size += 1) {
    const candidates = combinations(base, size).map((combination) => buildCombination(step, combination, context)).filter((candidate): candidate is CandidateScore => candidate !== null).sort(compareBestFit);
    if (candidates.length) return candidates.slice(0, 12);
  }
  return [];
}

function partialCandidates(step: WorkflowStep, models: CanonicalModel[], context: RecommendationContext) {
  const required = requiredCapabilitiesForStep(step);
  return models
    .map((model) => ({ model, covered: coverageFor(step, model) }))
    .filter((item) => item.covered.length > 0 && nonCoverageExclusionReasons(step, item.model, context, item.covered).length === 0)
    .map(({ model }) => scoreCandidate(step, model, context))
    .filter((candidate) => candidate.coveredCapabilities.length > 0)
    .map((candidate): CandidateScore => ({
      ...candidate,
      kind: "partial",
      roundedScore: Math.round((candidate.roundedScore * candidate.coveredCapabilities.length / Math.max(1, required.length)) / 5) * 5,
      explanation: [`Partial option only: covers ${candidate.coveredCapabilities.join(", ")}.`, `Missing ${candidate.missingCapabilities.join(", ")}.`],
      limitations: [...candidate.limitations, "This option does not satisfy every hard requirement"],
    }))
    .sort((a, b) => b.coveredCapabilities.length - a.coveredCapabilities.length || compareBestFit(a, b))
    .slice(0, 3);
}

function optionSet(candidates: CandidateScore[]): StepOptionSet {
  const identity = (candidate: CandidateScore) => candidate.tools.map((tool) => tool.model.canonicalId ?? tool.model.id).sort().join("+");
  const used = new Set<string>();
  const pick = (sorted: CandidateScore[]) => {
    const candidate = sorted.find((item) => !used.has(identity(item))) ?? sorted[0] ?? null;
    if (candidate) used.add(identity(candidate));
    return candidate;
  };
  const bestFit = pick([...candidates].sort(compareBestFit));
  const budget = pick([...candidates].sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd || a.tools.length - b.tools.length || b.roundedScore - a.roundedScore || compareBestFit(a, b)));
  const premium = pick([...candidates].sort((a, b) => b.qualityScore - a.qualityScore || compareBestFit(a, b)));
  const fastest = pick([...candidates].sort((a, b) => b.speedScore - a.speedScore || compareBestFit(a, b)));
  const privacy = pick([...candidates].sort((a, b) => b.privacyScore - a.privacyScore || compareBestFit(a, b)));
  return { bestFit, budget, premium, fastest, privacy };
}

function emptyOptions(): StepOptionSet { return { bestFit: null, budget: null, premium: null, fastest: null, privacy: null }; }

function stepSummary(step: WorkflowStep) {
  return { name: step.name, plainLanguageDescription: step.plainLanguageDescription, inputDescription: step.inputDescription, outputDescription: step.outputDescription, humanReviewRecommended: step.humanReviewRecommended, noAIEligible: step.noAIEligible, noAIAlternative: step.noAIAlternative };
}

function recommendStepData(step: WorkflowStep, models: CanonicalModel[], context: RecommendationContext) {
  const category = taskCategory(step);
  const requiredCapabilities = requiredCapabilitiesForStep(step);
  if (step.noAIEligible) {
    const recommendation: StepRecommendation = { stepId: step.id, step: stepSummary(step), taskCategory: category, requiredCapabilities, selected: null, options: emptyOptions(), alternatives: [], partialOptions: [], exclusions: [], dataUpdatedAt: null };
    return { recommendation, candidates: [] as CandidateScore[] };
  }
  const exclusions: Exclusion[] = [];
  const singles: CandidateScore[] = [];
  for (const model of models) {
    const reasons = getExclusionReasons(step, model, context);
    if (reasons.length) exclusions.push({ modelId: model.id, modelName: model.name, reasons });
    else singles.push(scoreCandidate(step, model, context));
  }
  singles.sort(compareBestFit);
  const candidates = singles.length ? singles : findCombinationCandidates(step, models, context);
  const options = optionSet(candidates);
  const partialOptions = candidates.length ? [] : partialCandidates(step, models, context);
  const alternatives = candidates.filter((candidate) => candidate !== options.bestFit).slice(0, 4);
  const timestamps = candidates.flatMap((candidate) => candidate.tools.map((tool) => tool.model.retrievedAt));
  const recommendation: StepRecommendation = {
    stepId: step.id,
    step: stepSummary(step),
    taskCategory: category,
    requiredCapabilities,
    selected: options.bestFit,
    options,
    alternatives,
    partialOptions,
    exclusions: exclusions.slice(0, MAX_EXCLUSIONS_PER_STEP),
    dataUpdatedAt: timestamps.length ? Math.min(...timestamps) : null,
  };
  return { recommendation, candidates };
}

export function recommendStep(step: WorkflowStep, models: CanonicalModel[], context: RecommendationContext): StepRecommendation {
  return recommendStepData(step, models, context).recommendation;
}

function prioritiesForVariant(original: Priority[], variant: StrategyVariant): Priority[] {
  const lead: Record<StrategyVariant, Priority> = { recommended: original[0], lowest_cost: "lowest_cost", highest_quality: "highest_quality", fastest: "fastest", privacy: "privacy" };
  return [lead[variant], ...original.filter((priority) => priority !== lead[variant])];
}

function productIdentity(tool: CandidateScore["tools"][number]) {
  const access = tool.access;
  const productName = access.productName ?? tool.model.provider;
  return {
    key: access.productId ?? `${tool.model.provider}:${productName}:${access.planName ?? access.accessMethod ?? "access"}`.toLowerCase(),
    productName,
    planName: access.planName ?? (access.accessMethod === "api" ? "Usage based API" : "Standard access"),
    accessMethod: access.accessMethod ?? "api" as const,
    monthlyPriceUsd: access.monthlyPriceUsd ?? null,
    accessUrl: access.url,
  };
}

function owned(existingTools: string[], tool: CandidateScore["tools"][number]) {
  const identity = productIdentity(tool);
  const haystack = `${identity.productName} ${identity.planName} ${tool.model.provider} ${tool.model.name}`.toLowerCase();
  return tool.model.existingTool || existingTools.some((item) => haystack.includes(item.toLowerCase()));
}

function candidateUtility(candidate: CandidateScore, variant: StrategyVariant, reusedProducts: number, newProducts: number, deadlineUrgent: boolean) {
  const base = variant === "lowest_cost"
    ? candidate.roundedScore * 0.4 + (1 / (1 + candidate.estimatedCostUsd)) * 60
    : variant === "highest_quality"
      ? candidate.qualityScore * 0.75 + candidate.roundedScore * 0.25
      : variant === "fastest"
        ? normalise(candidate.speedScore, 250) * 75 + candidate.roundedScore * 0.25
        : variant === "privacy"
          ? candidate.privacyScore * 0.75 + candidate.roundedScore * 0.25
          : candidate.roundedScore;
  const urgencyBoost = deadlineUrgent && variant === "recommended" ? normalise(candidate.speedScore, 250) * 10 : 0;
  return base + urgencyBoost + reusedProducts * 8 - newProducts * 6 - candidate.workflowFriction - Math.max(0, candidate.tools.length - 1) * 4;
}

type BeamState = { choices: Array<CandidateScore | null>; products: Set<string>; apiCost: number; fixedCost: number; utility: number };

function chooseGlobalStack(pools: CandidateScore[][], context: RecommendationContext, variant: StrategyVariant) {
  let beam: BeamState[] = [{ choices: [], products: new Set(), apiCost: 0, fixedCost: 0, utility: 0 }];
  const existingTools = context.existingTools ?? [];
  const deadlineTime = context.deadline ? new Date(`${context.deadline}T23:59:59Z`).getTime() : Number.POSITIVE_INFINITY;
  const deadlineUrgent = Number.isFinite(deadlineTime) && deadlineTime - context.now <= 7 * 86_400_000;
  for (const pool of pools) {
    const choices: Array<CandidateScore | null> = [...pool.slice(0, 8), null];
    const next: BeamState[] = [];
    for (const state of beam) for (const choice of choices) {
      if (!choice) { next.push({ ...state, choices: [...state.choices, null], utility: state.utility - 60 }); continue; }
      const identities = choice.tools.map(productIdentity);
      const newIdentities = identities.filter((identity) => !state.products.has(identity.key));
      const hasUnknownNewSubscription = choice.tools.some((tool, index) => {
        const identity = identities[index];
        return !state.products.has(identity.key) && !owned(existingTools, tool) && identity.accessMethod === "product" && identity.monthlyPriceUsd === null;
      });
      if (context.budgetUsd !== null && hasUnknownNewSubscription) continue;
      const fixedIncrement = choice.tools.reduce((sum, tool, index) => {
        const identity = identities[index];
        return sum + (!state.products.has(identity.key) && !owned(existingTools, tool) && identity.accessMethod === "product" ? identity.monthlyPriceUsd ?? 0 : 0);
      }, 0);
      const apiCost = state.apiCost + choice.estimatedCostUsd;
      const fixedCost = state.fixedCost + fixedIncrement;
      if (context.budgetUsd !== null && apiCost + fixedCost > context.budgetUsd + 0.0001) continue;
      const products = new Set(state.products);
      identities.forEach((identity) => products.add(identity.key));
      const reused = identities.length - newIdentities.length;
      next.push({ choices: [...state.choices, choice], products, apiCost, fixedCost, utility: state.utility + candidateUtility(choice, variant, reused, newIdentities.length, deadlineUrgent) });
    }
    beam = next.sort((a, b) => b.utility - a.utility || a.apiCost + a.fixedCost - (b.apiCost + b.fixedCost) || a.products.size - b.products.size).slice(0, BEAM_WIDTH);
  }
  return beam[0] ?? { choices: pools.map(() => null), products: new Set<string>(), apiCost: 0, fixedCost: 0, utility: -Infinity };
}

function subscriptionSummary(steps: StepRecommendation[], existingTools: string[]) {
  const summaries = new Map<string, SubscriptionSummary>();
  for (const step of steps) for (const tool of step.selected?.tools ?? []) {
    const identity = productIdentity(tool);
    const existing = summaries.get(identity.key);
    const alreadyOwned = owned(existingTools, tool);
    const next: SubscriptionSummary = existing ?? {
      productId: identity.key,
      productName: identity.productName,
      planName: identity.planName,
      accessMethod: identity.accessMethod,
      priceUsd: identity.monthlyPriceUsd,
      accessUrl: identity.accessUrl,
      stepIds: [],
      stepNames: [],
      modelNames: [],
      alreadyOwned,
      additionalCostUsd: alreadyOwned || identity.accessMethod !== "product" ? 0 : identity.monthlyPriceUsd,
      apiUsageEstimateUsd: 0,
    };
    if (!next.stepIds.includes(step.stepId)) next.stepIds.push(step.stepId);
    if (!next.stepNames.includes(step.step.name)) next.stepNames.push(step.step.name);
    if (!next.modelNames.includes(tool.model.name)) next.modelNames.push(tool.model.name);
    next.apiUsageEstimateUsd = Number((next.apiUsageEstimateUsd + tool.estimatedCostUsd).toFixed(4));
    summaries.set(identity.key, next);
  }
  return [...summaries.values()].sort((a, b) => (a.additionalCostUsd ?? Number.POSITIVE_INFINITY) - (b.additionalCostUsd ?? Number.POSITIVE_INFINITY) || a.productName.localeCompare(b.productName));
}

export function generateStrategyPlan(steps: WorkflowStep[], models: CanonicalModel[], context: RecommendationContext, variant: StrategyVariant): StrategyPlan {
  const priorities = prioritiesForVariant(context.priorities, variant);
  const data = steps.map((step) => recommendStepData(step, models, { ...context, priorities, budgetUsd: context.budgetUsd }));
  const stack = chooseGlobalStack(data.map((item) => item.candidates), { ...context, priorities }, variant);
  const recommendations = data.map(({ recommendation }, index) => ({ ...recommendation, selected: stack.choices[index] ?? null }));
  const existingTools = context.existingTools ?? [];
  const subscriptions = subscriptionSummary(recommendations, existingTools);
  const fixedCostUsd = Number(subscriptions.reduce((sum, item) => sum + (item.additionalCostUsd ?? 0), 0).toFixed(2));
  const apiCostUsd = Number(recommendations.reduce((sum, item) => sum + (item.selected?.estimatedCostUsd ?? 0), 0).toFixed(2));
  const estimatedSavingsUsd = Number(recommendations.reduce((sum, item) => sum + (item.selected?.estimatedSavingsUsd ?? 0), 0).toFixed(2));
  const dates = recommendations.map((item) => item.dataUpdatedAt).filter((value): value is number => value !== null);
  const kept = existingTools.filter((tool) => subscriptions.some((subscription) => `${subscription.productName} ${subscription.planName} ${subscription.modelNames.join(" ")}`.toLowerCase().includes(tool.toLowerCase())));
  const totalCostUsd = Number((fixedCostUsd + apiCostUsd).toFixed(2));
  const overBudgetUsd = context.budgetUsd === null ? 0 : Number(Math.max(0, totalCostUsd - context.budgetUsd).toFixed(2));
  const hasUnknownSubscriptionPricing = subscriptions.some((subscription) => subscription.accessMethod === "product" && !subscription.alreadyOwned && subscription.priceUsd === null);
  const completeStepCount = recommendations.filter((item) => item.step.noAIEligible || (item.selected && item.selected.missingCapabilities.length === 0)).length;
  const budgetCompatible = context.budgetUsd === null || (!hasUnknownSubscriptionPricing && totalCostUsd <= context.budgetUsd + 0.0001 && completeStepCount === recommendations.length);
  const budgetRemainingUsd = context.budgetUsd === null ? null : Number(Math.max(0, context.budgetUsd - totalCostUsd).toFixed(2));
  return {
    variant,
    steps: recommendations,
    fixedCostUsd,
    apiCostUsd,
    totalCostUsd,
    estimatedSavingsUsd,
    existingSubscriptions: { kept, couldCancel: existingTools.filter((tool) => !kept.includes(tool)) },
    subscriptions,
    uniqueProductCount: subscriptions.length,
    completeStepCount,
    budgetUsd: context.budgetUsd,
    overBudgetUsd,
    hasUnknownSubscriptionPricing,
    budgetCompatible,
    budgetRemainingUsd,
    inputsUsed: {
      projectDescription: context.projectDescription?.trim() || null,
      expectedResult: context.expectedResult?.trim() || null,
      budgetUsd: context.budgetUsd,
      deadline: context.deadline ?? null,
      priorityRanking: [...context.priorities],
      existingTools: [...(context.existingTools ?? [])],
      informationSensitivity: context.informationSensitivity ?? "standard",
      commercialUse: context.commercialUse ?? true,
      providersToAvoid: [...(context.providersToAvoid ?? [])],
      preferredLanguage: context.preferredLanguage?.trim() || "English",
      expectedOutputs: context.expectedOutputs?.trim() || null,
      region: context.region,
    },
    assumptions: [
      "Usage estimates come from the approved workflow.",
      "Single-tool options are exhausted before combinations are considered.",
      "A combination contains at most three verified tools and each tool must cover a distinct hard capability.",
      "Subscription prices are counted once across the roadmap; API usage remains workload-based.",
      "Existing subscriptions are treated as zero additional subscription cost where the product or plan name matches.",
      "Provider prices exclude taxes and third-party platform fees.",
      ...(context.budgetUsd !== null ? ["The entered budget is a hard cap across new subscription costs and estimated API usage; unpriced new subscriptions are not selected."] : []),
      `All saved requirements were applied: ${context.priorities.join(", ")} priority order; ${context.informationSensitivity ?? "standard"} information sensitivity; ${context.commercialUse ?? true ? "commercial" : "non-commercial"} use; ${context.preferredLanguage?.trim() || "English"} output.`,
      ...(hasUnknownSubscriptionPricing ? ["The displayed total is a known-cost subtotal; plans without a verified current price are not included."] : []),
    ],
    dataUpdatedAt: dates.length ? Math.min(...dates) : null,
  };
}

export function isMateriallyBetter(current: CandidateScore, candidate: CandidateScore) {
  const costReduction = current.estimatedCostUsd > 0 ? (current.estimatedCostUsd - candidate.estimatedCostUsd) / current.estimatedCostUsd : 0;
  return candidate.missingCapabilities.length < current.missingCapabilities.length
    || candidate.tools.length < current.tools.length
    || candidate.roundedScore >= current.roundedScore + 10
    || (candidate.roundedScore >= current.roundedScore && costReduction >= 0.15)
    || candidate.privacyScore >= current.privacyScore + 25;
}

export function planImprovementReasons(current: StrategyPlan, candidate: StrategyPlan) {
  const reasons: string[] = [];
  const costReduction = current.totalCostUsd > 0 ? (current.totalCostUsd - candidate.totalCostUsd) / current.totalCostUsd : 0;
  const currentAverage = current.steps.reduce((sum, step) => sum + (step.selected?.roundedScore ?? 0), 0) / Math.max(1, current.steps.length);
  const candidateAverage = candidate.steps.reduce((sum, step) => sum + (step.selected?.roundedScore ?? 0), 0) / Math.max(1, candidate.steps.length);
  if (costReduction >= 0.15) reasons.push("At least 15% lower total cost");
  if (candidateAverage >= currentAverage + 10) reasons.push("Materially higher task-specific quality");
  if (candidate.uniqueProductCount < current.uniqueProductCount) reasons.push("Fewer products or subscriptions");
  if (candidate.completeStepCount > current.completeStepCount) reasons.push("A previously unsupported requirement is now covered");
  const currentPrivacy = Math.min(...current.steps.map((step) => step.selected?.privacyScore ?? 0));
  const candidatePrivacy = Math.min(...candidate.steps.map((step) => step.selected?.privacyScore ?? 0));
  if (candidatePrivacy >= currentPrivacy + 25) reasons.push("Materially stronger privacy coverage");
  return reasons;
}

export function isPlanMateriallyBetter(current: StrategyPlan, candidate: StrategyPlan) {
  return planImprovementReasons(current, candidate).length > 0;
}
