"use node";

import { actionGeneric as action, internalActionGeneric as internalAction, anyApi } from "convex/server";
import { ConvexError, v } from "convex/values";
import { applicationErrorData } from "../../lib/application-errors";
import { validatePriorityRanking, WorkflowStepSchema, type WorkflowStep } from "../../lib/planner/schema";
import { generateStrategyPlan, planImprovementReasons } from "../../lib/recommendation/engine";
import type { CanonicalModel, RecommendationContext, StrategyPlan, StrategyVariant } from "../../lib/recommendation/types";
import type { AiFirstClass, ContributionLevel } from "../../lib/recommendation/ai-first";
import { requireIdentity } from "../lib/auth";

type StoredModel = {
  _id: string; canonicalId: string; name: string; provider: string; active: boolean; modalities: string[]; capabilities: string[]; contextWindow?: number;
  aiFirstClass?: AiFirstClass; aiRole?: string; aiContributionLevel?: ContributionLevel; automationLevel?: ContributionLevel; requiredManualWork?: string;
  commercialUse?: boolean; privacyLevel?: string; regions: string[]; updatedAt: number; mappingConfidence?: "exact" | "explicit_alias" | "unmatched";
  accessOptions?: Array<{
    label: string; url: string; modelId: string; sourceUrl: string; verifiedAt: number;
    productId?: string; productName?: string; planId?: string; planName?: string;
    accessMethod?: "product" | "api" | "marketplace" | "cloud"; monthlyPriceUsd?: number;
    aiFirstClass?: AiFirstClass; aiRole?: string; aiContributionLevel?: ContributionLevel; automationLevel?: ContributionLevel; requiredManualWork?: string;
  }>;
  capabilityEvidence?: Array<{ capabilities: string[]; category: string; sourceUrl: string; verifiedAt: number; confidence: string; notes?: string }>;
  benchmarks: Array<{ metric: string; score: number; rawValue?: unknown; normalizedValue?: number; category?: string; sourceUrl?: string; modelVersion?: string; measuredAt: number; retrievedAt: number; source: string; confidence: string; notes?: string }>;
  prices: Array<{ pricingType: string; amount: number; sourceUrl?: string; modelVersion?: string; retrievedAt: number; source: string; confidence?: string; notes?: string }>;
  privacy: Array<{ level: string; source: string; sourceUrl: string; retrievedAt: number; confidence: string; notes?: string }>;
  licenses: Array<{ commercialUse: boolean; source: string; sourceUrl: string; retrievedAt: number; confidence: string; notes?: string }>;
};

function latest<T extends { retrievedAt: number }>(items: T[], predicate: (item: T) => boolean) { return items.filter(predicate).sort((a,b)=>b.retrievedAt-a.retrievedAt)[0]; }
function toModel(model: StoredModel): CanonicalModel {
  const quality = latest(model.benchmarks, (item) => item.metric === "artificial_analysis_intelligence_index");
  const speed = latest(model.benchmarks, (item) => item.metric === "output_tokens_per_second");
  const input = latest(model.prices, (item) => item.pricingType === "input_tokens");
  const output = latest(model.prices, (item) => item.pricingType === "output_tokens");
  const image = latest(model.prices, (item) => item.pricingType === "image_generation");
  const video = latest(model.prices, (item) => item.pricingType === "video_generation");
  const transcription = latest(model.prices, (item) => item.pricingType === "speech_transcription");
  const speech = latest(model.prices, (item) => item.pricingType === "speech_generation");
  const privacy = model.privacy[0]; const license = model.licenses[0];
  const evidence = [
    ...model.benchmarks.map((item) => ({ kind: "benchmark" as const, source: item.source, sourceUrl: item.sourceUrl ?? null, retrievedAt: item.retrievedAt, modelVersion: item.modelVersion ?? null, metricName: item.metric, rawValue: item.rawValue ?? item.score, normalizedValue: item.normalizedValue ?? null, category: item.category ?? "general", confidence: item.confidence, notes: item.notes ?? null })),
    ...(model.capabilityEvidence ?? []).map((item) => ({ kind: "capability" as const, source: "Official product documentation", sourceUrl: item.sourceUrl, retrievedAt: item.verifiedAt, modelVersion: model.canonicalId, metricName: "official_product_capabilities", rawValue: item.capabilities, normalizedValue: null, category: item.category, confidence: item.confidence, notes: item.notes ?? null })),
    ...model.prices.map((item) => ({ kind: "pricing" as const, source: item.source, sourceUrl: item.sourceUrl ?? null, retrievedAt: item.retrievedAt, modelVersion: item.modelVersion ?? null, metricName: item.pricingType, rawValue: item.amount, normalizedValue: null, category: "cost", confidence: item.confidence ?? "source_reported", notes: item.notes ?? null })),
    ...model.privacy.map((item) => ({ kind: "privacy" as const, source: item.source, sourceUrl: item.sourceUrl, retrievedAt: item.retrievedAt, modelVersion: null, metricName: "privacy_level", rawValue: item.level, normalizedValue: null, category: "privacy", confidence: item.confidence, notes: item.notes ?? null })),
    ...model.licenses.map((item) => ({ kind: "license" as const, source: item.source, sourceUrl: item.sourceUrl, retrievedAt: item.retrievedAt, modelVersion: null, metricName: "commercial_use", rawValue: item.commercialUse, normalizedValue: null, category: "license", confidence: item.confidence, notes: item.notes ?? null })),
  ];
  return { id: model._id, canonicalId: model.canonicalId, name: model.name, provider: model.provider, active: model.active, modalities: model.modalities, capabilities: model.capabilities, aiFirstClass: model.aiFirstClass, aiRole: model.aiRole, aiContributionLevel: model.aiContributionLevel, automationLevel: model.automationLevel, requiredManualWork: model.requiredManualWork, contextWindow: model.contextWindow ?? null, inputPricePerMillion: input?.amount ?? null, outputPricePerMillion: output?.amount ?? null, imagePricePerThousand: image?.amount ?? null, videoPricePerMinute: video?.amount ?? null, audioPricePerMinute: transcription?.amount ?? null, speechPricePerMillionCharacters: speech?.amount ?? null, qualityScore: quality?.score ?? null, outputTokensPerSecond: speed?.score ?? null, privacyLevel: (privacy?.level as CanonicalModel["privacyLevel"]) ?? (model.privacyLevel as CanonicalModel["privacyLevel"]) ?? null, commercialUse: license?.commercialUse ?? model.commercialUse ?? null, regions: model.regions, source: quality?.source ?? input?.source ?? image?.source ?? video?.source ?? transcription?.source ?? speech?.source ?? model.capabilityEvidence?.[0]?.sourceUrl ?? "stored snapshot", sourceUrl: quality?.sourceUrl ?? input?.sourceUrl ?? image?.sourceUrl ?? video?.sourceUrl ?? transcription?.sourceUrl ?? speech?.sourceUrl ?? model.capabilityEvidence?.[0]?.sourceUrl ?? null, measuredAt: quality?.measuredAt ?? null, retrievedAt: Math.max(quality?.retrievedAt ?? 0,input?.retrievedAt ?? 0,output?.retrievedAt ?? 0,image?.retrievedAt ?? 0,video?.retrievedAt ?? 0,transcription?.retrievedAt ?? 0,speech?.retrievedAt ?? 0,privacy?.retrievedAt ?? 0,license?.retrievedAt ?? 0,...(model.capabilityEvidence ?? []).map((item) => item.verifiedAt),model.updatedAt), existingTool: false, evidence, mappingConfidence: model.mappingConfidence, accessOptions: model.accessOptions ?? [] };
}

function toStep(record: { _id: string; order: number; name: string; description: string; requirements: unknown; estimates: unknown }): WorkflowStep {
  const requirements = record.requirements as Record<string, unknown>; const estimates = record.estimates as Record<string, unknown>;
  return WorkflowStepSchema.parse({ id: record._id, order: record.order, name: record.name, plainLanguageDescription: record.description, inputDescription: requirements.inputDescription ?? "User-provided material", outputDescription: requirements.outputDescription ?? "Completed step", dependencies: requirements.dependencies ?? [], canRunInParallel: requirements.canRunInParallel ?? false, estimatedInputTokensLow: estimates.inputLow ?? 0, estimatedInputTokensExpected: estimates.inputExpected ?? 0, estimatedInputTokensHigh: estimates.inputHigh ?? 0, estimatedOutputTokensLow: estimates.outputLow ?? 0, estimatedOutputTokensExpected: estimates.outputExpected ?? 0, estimatedOutputTokensHigh: estimates.outputHigh ?? 0, estimatedRequestCount: estimates.requests ?? 0, estimatedImageCount: estimates.images ?? 0, estimatedAudioMinutes: estimates.audioMinutes ?? 0, estimatedVideoMinutes: estimates.videoMinutes ?? 0, requiredModalities: requirements.requiredModalities ?? [], requiredCapabilities: requirements.requiredCapabilities ?? [], requiresCurrentInformation: requirements.requiresCurrentInformation ?? false, privacyRequirement: requirements.privacyRequirement ?? "standard", commercialUseRequired: requirements.commercialUseRequired ?? false, minimumQuality: requirements.minimumQuality ?? "good", importance: requirements.importance ?? "medium", noAIEligible: requirements.noAIEligible ?? false, noAIAlternative: requirements.noAIAlternative ?? "Complete manually", humanReviewRecommended: requirements.humanReviewRecommended ?? true, assumptions: requirements.assumptions ?? [] });
}

function recommendationContext(strategy: {
  priorities: string[]; budget?: number; usageType: "one_off" | "monthly"; deadline?: string; originalInput: string; expectedResult: string;
  existingTools?: string[]; informationSensitivity?: string; commercialUse?: boolean; providersToAvoid?: string[]; preferredLanguage?: string; expectedOutputs?: string;
}, region: string): RecommendationContext {
  return {
    priorities: validatePriorityRanking(strategy.priorities),
    budgetUsd: strategy.budget ?? null,
    region,
    now: Date.now(),
    existingTools: strategy.existingTools ?? [],
    usageType: strategy.usageType,
    deadline: strategy.deadline,
    projectDescription: strategy.originalInput,
    expectedResult: strategy.expectedResult,
    informationSensitivity: strategy.informationSensitivity ?? "standard",
    commercialUse: strategy.commercialUse ?? true,
    providersToAvoid: strategy.providersToAvoid ?? [],
    preferredLanguage: strategy.preferredLanguage ?? "English",
    expectedOutputs: strategy.expectedOutputs,
  };
}

export const generate = action({ args: { strategyId: v.id("strategies"), region: v.string() }, handler: async (ctx, args) => {
  await requireIdentity(ctx); const { strategyId, region } = args;
  const owned = await ctx.runQuery(anyApi.strategies.getOwned, { strategyId });
  if (owned.strategy.status !== "approved" && owned.strategy.status !== "complete") throw new ConvexError(applicationErrorData("WORKFLOW_NOT_APPROVED"));
  const snapshots = await ctx.runQuery(anyApi.modelSync.latestValidSnapshots, {});
  if (!snapshots.length) throw new ConvexError(applicationErrorData("INSUFFICIENT_EVIDENCE"));
  const snapshot = [...snapshots].sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
  const snapshotSummary = [...snapshots].sort((a, b) => a.fetchedAt - b.fetchedAt).map((item) => ({ id: item._id, fetchedAt: item.fetchedAt, source: item.source, sourceUrl: item.sourceUrl, attribution: item.attribution, sourceVersion: item.sourceVersion }));
  const oldestEvidenceAt = Math.min(...snapshotSummary.map((item) => item.fetchedAt));
  const storedModels = await ctx.runQuery(anyApi.models.catalog, {}) as StoredModel[];
  const existingTools = owned.strategy.existingTools ?? [];
  const context = recommendationContext(owned.strategy, region);
  const variants: StrategyVariant[] = ["recommended", "lowest_cost", "highest_quality", "fastest", "privacy"];
  const models = storedModels.map(toModel).map((model) => ({ ...model, existingTool: existingTools.some((tool: string) => `${model.provider} ${model.name}`.toLowerCase().includes(tool.toLowerCase())) }));
  const plans = variants.map((variant) => generateStrategyPlan(owned.steps.map(toStep), models, context, variant));
  await ctx.runMutation(anyApi.strategies.saveGeneratedPlans, { strategyId, dataSnapshotId: snapshot._id, dataSnapshotSummary: snapshotSummary, plans });
  const entitlement = await ctx.runQuery(anyApi.subscriptions.entitlement, {});
  if (!entitlement.canViewFullResults) return { locked: true, usageType: owned.strategy.usageType, estimatedCompletionTime: owned.strategy.estimatedCompletionTime, plans: [{ ...plans[0], steps: plans[0].steps.map((step) => ({ ...step, alternatives: [] })) }], dataSnapshot: { id: snapshot._id, fetchedAt: oldestEvidenceAt, sources: snapshotSummary } };
  return { locked: false, usageType: owned.strategy.usageType, estimatedCompletionTime: owned.strategy.estimatedCompletionTime, plans, dataSnapshot: { id: snapshot._id, fetchedAt: oldestEvidenceAt, sources: snapshotSummary } };
} });

function storedPlan(record: { planType: string; recommendations: unknown; costEstimate: unknown; assumptions: string[]; fullPlan?: unknown }): StrategyPlan | null {
  if (record.fullPlan) return record.fullPlan as StrategyPlan;
  const steps = Array.isArray(record.recommendations) ? record.recommendations as StrategyPlan["steps"] : [];
  const costs = record.costEstimate as { fixed?: number; api?: number; total?: number };
  if (!steps.length) return null;
  const products = new Set(steps.flatMap((step) => step.selected?.tools?.map((tool) => tool.access?.productId ?? `${tool.model.provider}:${tool.model.name}`) ?? (step.selected ? [`${step.selected.model.provider}:${step.selected.model.name}`] : [])));
  return {
    variant: record.planType as StrategyVariant,
    steps,
    fixedCostUsd: costs.fixed ?? 0,
    apiCostUsd: costs.api ?? 0,
    totalCostUsd: costs.total ?? 0,
    estimatedSavingsUsd: 0,
    existingSubscriptions: { kept: [], couldCancel: [] },
    subscriptions: [],
    uniqueProductCount: products.size,
    completeStepCount: steps.filter((step) => step.step?.noAIEligible || step.selected).length,
    budgetUsd: null,
    overBudgetUsd: 0,
    hasUnknownSubscriptionPricing: false,
    budgetCompatible: true,
    budgetRemainingUsd: null,
    inputsUsed: {
      projectDescription: null, expectedResult: null, budgetUsd: null, deadline: null, priorityRanking: [], existingTools: [],
      informationSensitivity: "standard", commercialUse: true, providersToAvoid: [], preferredLanguage: "English", expectedOutputs: null, region: "global",
    },
    assumptions: record.assumptions,
    dataUpdatedAt: null,
  };
}

export const loadSaved = action({ args: { strategyId: v.id("strategies") }, handler: async (ctx, { strategyId }) => {
  await requireIdentity(ctx);
  const owned = await ctx.runQuery(anyApi.strategies.getOwned, { strategyId });
  if (owned.strategy.status !== "complete") return null;
  const stored = await ctx.runQuery(anyApi.strategies.getStoredResult, { strategyId }) as null | {
    plans: Array<{ planType: string; recommendations: unknown; costEstimate: unknown; assumptions: string[]; fullPlan?: unknown; dataSnapshotSummary?: unknown }>;
    dataSnapshot: null | { _id: string; fetchedAt: number; source: string; sourceUrl?: string; attribution?: string; sourceVersion?: string };
  };
  if (!stored?.plans.length || !stored.dataSnapshot) return null;
  const variantOrder: StrategyVariant[] = ["recommended", "lowest_cost", "highest_quality", "fastest", "privacy"];
  const plans = stored.plans.map(storedPlan).filter((plan): plan is StrategyPlan => Boolean(plan)).sort((a, b) => variantOrder.indexOf(a.variant) - variantOrder.indexOf(b.variant));
  if (!plans.length) return null;
  const storedSummary = stored.plans[0].dataSnapshotSummary;
  const sources = Array.isArray(storedSummary) ? storedSummary : [{ id: stored.dataSnapshot._id, fetchedAt: stored.dataSnapshot.fetchedAt, source: stored.dataSnapshot.source, sourceUrl: stored.dataSnapshot.sourceUrl, attribution: stored.dataSnapshot.attribution, sourceVersion: stored.dataSnapshot.sourceVersion }];
  const fetchedAt = Math.min(...sources.map((source) => typeof source === "object" && source && "fetchedAt" in source ? Number(source.fetchedAt) : stored.dataSnapshot!.fetchedAt));
  const entitlement = await ctx.runQuery(anyApi.subscriptions.entitlement, {});
  const visiblePlans = entitlement.canViewFullResults ? plans : [{ ...plans[0], steps: plans[0].steps.map((step) => ({ ...step, alternatives: [] })) }];
  return { locked: !entitlement.canViewFullResults, usageType: owned.strategy.usageType, estimatedCompletionTime: owned.strategy.estimatedCompletionTime, plans: visiblePlans, dataSnapshot: { id: stored.dataSnapshot._id, fetchedAt, sources } };
} });

export const reEvaluatePending = internalAction({ args: {}, handler: async (ctx) => {
  const pending = await ctx.runQuery(anyApi.strategies.pendingRefreshes, { limit: 20 });
  if (!pending.length) return { evaluated: 0, available: 0 };
  const storedModels = await ctx.runQuery(anyApi.models.catalogInternal, {}) as StoredModel[];
  const models = storedModels.map(toModel);
  let available = 0;
  for (const item of pending) {
    try {
      if (!item.strategy || !item.steps.length) throw new Error("STRATEGY_NOT_FOUND");
      const currentRecord = item.plans.find((plan: { planType: string }) => plan.planType === "recommended");
      const current = currentRecord ? storedPlan(currentRecord) : null;
      if (!current) throw new Error("CURRENT_PLAN_NOT_FOUND");
      const context = recommendationContext(item.strategy, "global");
      const variants: StrategyVariant[] = ["recommended", "lowest_cost", "highest_quality", "fastest", "privacy"];
      const plans = variants.map((variant) => generateStrategyPlan(item.steps.map(toStep), models, context, variant));
      const reasons = planImprovementReasons(current, plans[0]);
      await ctx.runMutation(anyApi.strategies.completeRefreshEvaluation, { refreshId: item.refresh._id, status: reasons.length ? "available" : "no_change", improvementReasons: reasons, proposedPlans: reasons.length ? plans : undefined });
      if (reasons.length) available += 1;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.slice(0, 80) : "REFRESH_FAILED";
      await ctx.runMutation(anyApi.strategies.completeRefreshEvaluation, { refreshId: item.refresh._id, status: "failed", improvementReasons: [], errorCode });
    }
  }
  return { evaluated: pending.length, available };
} });
