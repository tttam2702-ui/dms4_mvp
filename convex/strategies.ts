import { internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { v } from "convex/values";
import { canAccessStrategy, requireUser } from "./lib/auth";
import { taskCategory } from "../lib/recommendation/engine";
import type { WorkflowStep } from "../lib/planner/schema";

export const listMine = query({ args: {}, handler: async (ctx) => {
  const user = await requireUser(ctx);
  const strategies = await ctx.db.query("strategies").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(20);
  return Promise.all(strategies.map(async (strategy) => {
    const refreshes = await ctx.db.query("strategyRefreshes").withIndex("by_strategy", (q) => q.eq("strategyId", strategy._id)).order("desc").take(10);
    const refresh = refreshes.find((item) => item.status === "available");
    return { ...strategy, refreshAvailable: Boolean(refresh), refreshReasons: refresh?.improvementReasons ?? [] };
  }));
} });

export const getOwned = query({ args: { strategyId: v.id("strategies") }, handler: async (ctx, args) => {
  const { strategyId } = args; const user = await requireUser(ctx); const strategy = await ctx.db.get(strategyId);
  if (!strategy || !(await canAccessStrategy(ctx.db, String(user._id), strategy))) throw new Error("Not found");
  const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  return { strategy, steps };
} });

export const getStoredResult = internalQuery({ args: { strategyId: v.id("strategies") }, handler: async (ctx, { strategyId }) => {
  const plans = await ctx.db.query("strategyPlans").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  if (!plans.length) return null;
  const dataSnapshot = await ctx.db.get(plans[0].dataSnapshotId);
  return { plans, dataSnapshot };
} });

export const create = mutation({
  args: { usageType: v.union(v.literal("one_off"), v.literal("monthly")), title: v.string(), originalInput: v.string(), expectedResult: v.string(), deadline: v.optional(v.string()), budget: v.optional(v.number()), budgetAmount: v.optional(v.number()), budgetCurrency: v.optional(v.string()), monthlyTasks: v.optional(v.array(v.any())), existingTools: v.optional(v.array(v.string())), priorities: v.array(v.string()), informationSensitivity: v.optional(v.string()), commercialUse: v.optional(v.boolean()), providersToAvoid: v.optional(v.array(v.string())), preferredLanguage: v.optional(v.string()), expectedOutputs: v.optional(v.string()) },
  handler: async (ctx, args) => { const user = await requireUser(ctx); const now = Date.now(); return ctx.db.insert("strategies", { ...args, userId: user._id, status: "draft", createdAt: now, updatedAt: now }); },
});

export const duplicate = mutation({ args: { strategyId: v.id("strategies") }, handler: async (ctx, args) => {
  const { strategyId } = args; const user = await requireUser(ctx); const strategy = await ctx.db.get(strategyId);
  if (!strategy || String(strategy.userId) !== String(user._id)) throw new Error("Forbidden");
  const now = Date.now();
  const copyId = await ctx.db.insert("strategies", {
    userId: user._id, usageType: strategy.usageType, title: `${strategy.title} (copy)`,
    originalInput: strategy.originalInput, expectedResult: strategy.expectedResult,
    deadline: strategy.deadline, budget: strategy.budget, budgetAmount: strategy.budgetAmount, budgetCurrency: strategy.budgetCurrency,
    monthlyTasks: strategy.monthlyTasks, existingTools: strategy.existingTools, priorities: strategy.priorities, estimatedCompletionTime: strategy.estimatedCompletionTime,
    informationSensitivity: strategy.informationSensitivity, commercialUse: strategy.commercialUse, providersToAvoid: strategy.providersToAvoid,
    preferredLanguage: strategy.preferredLanguage, expectedOutputs: strategy.expectedOutputs,
    status: "planned", createdAt: now, updatedAt: now,
  });
  const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  for (const step of steps) await ctx.db.insert("workflowSteps", {
    strategyId: copyId, order: step.order, name: step.name, description: step.description,
    requirements: step.requirements, estimates: step.estimates, approved: false, createdAt: now, updatedAt: now,
  });
  return copyId;
} });

export const replaceWorkflow = mutation({
  args: { strategyId: v.id("strategies"), steps: v.array(v.object({ order: v.number(), name: v.string(), description: v.string(), requirements: v.any(), estimates: v.any() })) },
  handler: async (ctx, args) => {
    const { strategyId, steps } = args; const user = await requireUser(ctx); const strategy = await ctx.db.get(strategyId);
    if (!strategy || String(strategy.userId) !== String(user._id)) throw new Error("Forbidden");
    const existing = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
    await Promise.all(existing.map((step) => ctx.db.delete(step._id))); const now = Date.now();
    for (const step of steps) await ctx.db.insert("workflowSteps", { strategyId, ...step, approved: false, createdAt: now, updatedAt: now });
    await ctx.db.patch(strategyId, { status: "planned", updatedAt: now });
  },
});

export const approveWorkflow = mutation({ args: { strategyId: v.id("strategies") }, handler: async (ctx, args) => {
  const { strategyId } = args; const user = await requireUser(ctx); const strategy = await ctx.db.get(strategyId);
  if (!strategy || String(strategy.userId) !== String(user._id)) throw new Error("Forbidden");
  const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  for (const step of steps) await ctx.db.patch(step._id, { approved: true, updatedAt: Date.now() });
  await ctx.db.patch(strategyId, { status: "approved", updatedAt: Date.now() });
} });

export const remove = mutation({ args: { strategyId: v.id("strategies") }, handler: async (ctx, args) => {
  const { strategyId } = args; const user = await requireUser(ctx); const strategy = await ctx.db.get(strategyId);
  if (!strategy || String(strategy.userId) !== String(user._id)) throw new Error("Forbidden");
  const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  for (const step of steps) await ctx.db.delete(step._id); await ctx.db.delete(strategyId);
} });

export const saveGeneratedPlans = internalMutation({ args: { strategyId: v.id("strategies"), dataSnapshotId: v.id("dataSnapshots"), dataSnapshotSummary: v.optional(v.any()), plans: v.array(v.any()) }, handler: async (ctx, { strategyId, dataSnapshotId, dataSnapshotSummary, plans }) => {
  const existing = await ctx.db.query("strategyPlans").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  for (const plan of existing) await ctx.db.delete(plan._id);
  for (const plan of plans) await ctx.db.insert("strategyPlans", { strategyId, planType: String(plan.variant), recommendations: [], costEstimate: { fixed: plan.fixedCostUsd, api: plan.apiCostUsd, total: plan.totalCostUsd }, timeEstimate: {}, confidence: plan.steps.some((step: { selected?: { label?: string } | null }) => step.selected?.label === "Limited Evidence") ? "Limited Evidence" : "Good Fit", assumptions: plan.assumptions, dataSnapshotId, dataSnapshotSummary, fullPlan: plan, createdAt: Date.now() });
  const refreshes = await ctx.db.query("strategyRefreshes").withIndex("by_strategy", (q) => q.eq("strategyId", strategyId)).collect();
  for (const refresh of refreshes.filter((item) => item.status === "available")) await ctx.db.patch(refresh._id, { status: "applied", evaluatedAt: Date.now() });
  await ctx.db.patch(strategyId, { status: "complete", updatedAt: Date.now() });
} });

function storedStep(record: { _id: string; order: number; name: string; description: string; requirements: unknown; estimates: unknown }): WorkflowStep {
  const requirements = record.requirements as Record<string, unknown>;
  const estimates = record.estimates as Record<string, unknown>;
  return {
    id: record._id, order: record.order, name: record.name, plainLanguageDescription: record.description,
    inputDescription: String(requirements.inputDescription ?? "User-provided material"), outputDescription: String(requirements.outputDescription ?? "Completed step"),
    dependencies: Array.isArray(requirements.dependencies) ? requirements.dependencies as string[] : [], canRunInParallel: Boolean(requirements.canRunInParallel),
    estimatedInputTokensLow: Number(estimates.inputLow ?? 0), estimatedInputTokensExpected: Number(estimates.inputExpected ?? 0), estimatedInputTokensHigh: Number(estimates.inputHigh ?? 0),
    estimatedOutputTokensLow: Number(estimates.outputLow ?? 0), estimatedOutputTokensExpected: Number(estimates.outputExpected ?? 0), estimatedOutputTokensHigh: Number(estimates.outputHigh ?? 0),
    estimatedRequestCount: Number(estimates.requests ?? 0), estimatedImageCount: Number(estimates.images ?? 0), estimatedAudioMinutes: Number(estimates.audioMinutes ?? 0), estimatedVideoMinutes: Number(estimates.videoMinutes ?? 0),
    requiredModalities: Array.isArray(requirements.requiredModalities) ? requirements.requiredModalities as WorkflowStep["requiredModalities"] : [], requiredCapabilities: Array.isArray(requirements.requiredCapabilities) ? requirements.requiredCapabilities as string[] : [],
    requiresCurrentInformation: Boolean(requirements.requiresCurrentInformation), privacyRequirement: (requirements.privacyRequirement ?? "standard") as WorkflowStep["privacyRequirement"],
    commercialUseRequired: Boolean(requirements.commercialUseRequired), minimumQuality: (requirements.minimumQuality ?? "good") as WorkflowStep["minimumQuality"], importance: (requirements.importance ?? "medium") as WorkflowStep["importance"],
    noAIEligible: Boolean(requirements.noAIEligible), noAIAlternative: String(requirements.noAIAlternative ?? "Complete manually"), humanReviewRecommended: requirements.humanReviewRecommended !== false,
    assumptions: Array.isArray(requirements.assumptions) ? requirements.assumptions as string[] : [],
  };
}

export const queueEvidenceRefreshes = internalMutation({ args: { source: v.string(), snapshotId: v.id("dataSnapshots"), categories: v.array(v.string()) }, handler: async (ctx, args) => {
  if (!args.categories.length) return 0;
  const affected = new Set(args.categories);
  const strategies = (await ctx.db.query("strategies").collect()).filter((strategy) => strategy.status === "complete");
  let queued = 0;
  for (const strategy of strategies) {
    const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", strategy._id)).collect();
    const categories = [...new Set(steps.map((step) => taskCategory(storedStep(step))))];
    if (!categories.some((category) => affected.has(category))) continue;
    const existing = await ctx.db.query("strategyRefreshes").withIndex("by_strategy", (q) => q.eq("strategyId", strategy._id)).order("desc").take(10);
    if (existing.some((item) => item.status === "pending" && item.source === args.source)) continue;
    await ctx.db.insert("strategyRefreshes", { strategyId: strategy._id, source: args.source, snapshotId: args.snapshotId, affectedCategories: categories.filter((category) => affected.has(category)), status: "pending", improvementReasons: [], createdAt: Date.now() });
    queued += 1;
  }
  return queued;
} });

export const pendingRefreshes = internalQuery({ args: { limit: v.number() }, handler: async (ctx, { limit }) => {
  const pending = await ctx.db.query("strategyRefreshes").withIndex("by_status", (q) => q.eq("status", "pending")).order("asc").take(Math.min(limit, 25));
  return Promise.all(pending.map(async (refresh) => {
    const strategy = await ctx.db.get(refresh.strategyId);
    const steps = await ctx.db.query("workflowSteps").withIndex("by_strategy", (q) => q.eq("strategyId", refresh.strategyId)).collect();
    const plans = await ctx.db.query("strategyPlans").withIndex("by_strategy", (q) => q.eq("strategyId", refresh.strategyId)).order("desc").take(10);
    return { refresh, strategy, steps, plans };
  }));
} });

export const completeRefreshEvaluation = internalMutation({ args: { refreshId: v.id("strategyRefreshes"), status: v.union(v.literal("available"), v.literal("no_change"), v.literal("failed")), improvementReasons: v.array(v.string()), proposedPlans: v.optional(v.any()), errorCode: v.optional(v.string()) }, handler: async (ctx, args) => {
  await ctx.db.patch(args.refreshId, { status: args.status, improvementReasons: args.improvementReasons, proposedPlans: args.proposedPlans, errorCode: args.errorCode, evaluatedAt: Date.now() });
} });

export const saveAnalysisSummary = internalMutation({ args: { strategyId: v.id("strategies"), estimatedCompletionTime: v.string() }, handler: async (ctx, { strategyId, estimatedCompletionTime }) => {
  await ctx.db.patch(strategyId, { estimatedCompletionTime, updatedAt: Date.now() });
} });
