import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkUserId: v.optional(v.string()), email: v.string(), name: v.optional(v.string()), avatarUrl: v.optional(v.string()),
    accountType: v.optional(v.union(v.literal("individual"), v.literal("team"), v.literal("enterprise"))),
    onboardingComplete: v.boolean(), preferredLanguage: v.string(), deletedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_email", ["email"]).index("by_clerk_user_id", ["clerkUserId"]),
  profiles: defineTable({
    userId: v.id("users"), answers: v.optional(v.any()), profession: v.optional(v.string()), industry: v.optional(v.string()),
    teamSize: v.optional(v.string()), companySize: v.optional(v.string()), departments: v.optional(v.array(v.string())),
    country: v.optional(v.string()), preferredLanguage: v.optional(v.string()), AIExperience: v.optional(v.string()),
    monthlyBudget: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_user", ["userId"]),
  strategies: defineTable({
    userId: v.id("users"), teamId: v.optional(v.id("teams")), usageType: v.union(v.literal("one_off"), v.literal("monthly")),
    title: v.string(), originalInput: v.string(), expectedResult: v.string(), deadline: v.optional(v.string()), budget: v.optional(v.number()),
    budgetAmount: v.optional(v.number()), budgetCurrency: v.optional(v.string()), monthlyTasks: v.optional(v.array(v.any())),
    existingTools: v.optional(v.array(v.string())), priorities: v.array(v.string()), estimatedCompletionTime: v.optional(v.string()),
    informationSensitivity: v.optional(v.string()), commercialUse: v.optional(v.boolean()), providersToAvoid: v.optional(v.array(v.string())),
    preferredLanguage: v.optional(v.string()), expectedOutputs: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("planned"), v.literal("approved"), v.literal("complete")),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user", ["userId", "updatedAt"]).index("by_team", ["teamId", "updatedAt"]),
  workflowSteps: defineTable({
    strategyId: v.id("strategies"), order: v.number(), name: v.string(), description: v.string(), requirements: v.any(), estimates: v.any(),
    approved: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_strategy", ["strategyId", "order"]),
  strategyPlans: defineTable({
    strategyId: v.id("strategies"), planType: v.string(), recommendations: v.any(), costEstimate: v.any(), timeEstimate: v.any(),
    confidence: v.string(), assumptions: v.array(v.string()), dataSnapshotId: v.id("dataSnapshots"), dataSnapshotSummary: v.optional(v.any()), fullPlan: v.optional(v.any()), createdAt: v.number(),
  }).index("by_strategy", ["strategyId", "createdAt"]),
  strategyRefreshes: defineTable({
    strategyId: v.id("strategies"), source: v.string(), snapshotId: v.id("dataSnapshots"), affectedCategories: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("available"), v.literal("no_change"), v.literal("applied"), v.literal("failed")),
    improvementReasons: v.array(v.string()), proposedPlans: v.optional(v.any()), errorCode: v.optional(v.string()), createdAt: v.number(), evaluatedAt: v.optional(v.number()),
  }).index("by_status", ["status", "createdAt"]).index("by_strategy", ["strategyId", "createdAt"]),
  canonicalModels: defineTable({
    canonicalId: v.string(), name: v.string(), provider: v.string(), modalities: v.array(v.string()), capabilities: v.array(v.string()),
    aiFirstClass: v.optional(v.union(v.literal("AI_NATIVE"), v.literal("AI_CENTRIC"), v.literal("AI_ASSISTED"), v.literal("TRADITIONAL"))),
    aiRole: v.optional(v.string()), aiContributionLevel: v.optional(v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH"))),
    automationLevel: v.optional(v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH"))), requiredManualWork: v.optional(v.string()),
    contextWindow: v.optional(v.number()), active: v.boolean(), commercialUse: v.optional(v.boolean()), privacyLevel: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())), releaseDate: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending_evidence"), v.literal("eligible"), v.literal("manual_review"), v.literal("inactive"))),
    mappingConfidence: v.optional(v.union(v.literal("exact"), v.literal("explicit_alias"), v.literal("unmatched"))),
    manualReviewRequired: v.optional(v.boolean()), regions: v.array(v.string()),
    accessOptions: v.optional(v.array(v.object({
      label: v.string(), url: v.string(), modelId: v.string(), sourceUrl: v.string(), verifiedAt: v.number(),
      productId: v.optional(v.string()), productName: v.optional(v.string()), planId: v.optional(v.string()), planName: v.optional(v.string()),
      accessMethod: v.optional(v.union(v.literal("product"), v.literal("api"), v.literal("marketplace"), v.literal("cloud"))),
      monthlyPriceUsd: v.optional(v.number()),
      aiFirstClass: v.optional(v.union(v.literal("AI_NATIVE"), v.literal("AI_CENTRIC"), v.literal("AI_ASSISTED"), v.literal("TRADITIONAL"))),
      aiRole: v.optional(v.string()), aiContributionLevel: v.optional(v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH"))),
      automationLevel: v.optional(v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH"))), requiredManualWork: v.optional(v.string()),
    }))),
    capabilityEvidence: v.optional(v.array(v.object({
      capabilities: v.array(v.string()), category: v.string(), sourceUrl: v.string(), verifiedAt: v.number(), confidence: v.string(), notes: v.optional(v.string()),
    }))),
    updatedAt: v.number(),
  }).index("by_canonical_id", ["canonicalId"]).index("by_provider", ["provider", "active"]),
  benchmarkObservations: defineTable({
    modelId: v.id("canonicalModels"), metric: v.string(), score: v.number(), rawValue: v.optional(v.any()), normalizedValue: v.optional(v.number()),
    category: v.optional(v.string()), source: v.string(), sourceUrl: v.optional(v.string()), modelVersion: v.optional(v.string()),
    sourceVersion: v.optional(v.string()), measuredAt: v.number(), retrievedAt: v.number(), confidence: v.string(), notes: v.optional(v.string()),
  }).index("by_model_metric", ["modelId", "metric", "retrievedAt"])
    .index("by_model_retrieved", ["modelId", "retrievedAt"])
    .index("by_model_metric_source", ["modelId", "metric", "source", "modelVersion"]),
  pricingObservations: defineTable({
    modelId: v.id("canonicalModels"), pricingType: v.string(), amount: v.number(), unit: v.string(), currency: v.string(),
    source: v.string(), sourceUrl: v.optional(v.string()), modelVersion: v.optional(v.string()), sourceVersion: v.optional(v.string()), confidence: v.optional(v.string()),
    notes: v.optional(v.string()), effectiveAt: v.number(), retrievedAt: v.number(),
  }).index("by_model_type", ["modelId", "pricingType", "retrievedAt"])
    .index("by_model_retrieved", ["modelId", "retrievedAt"])
    .index("by_model_type_source", ["modelId", "pricingType", "source", "modelVersion"]),
  privacyObservations: defineTable({
    modelId: v.id("canonicalModels"), level: v.string(), source: v.string(), sourceUrl: v.string(), retrievedAt: v.number(), confidence: v.string(), notes: v.optional(v.string()),
  }).index("by_model", ["modelId", "retrievedAt"]).index("by_model_level_source", ["modelId", "level", "source"]),
  licenseObservations: defineTable({
    modelId: v.id("canonicalModels"), commercialUse: v.boolean(), source: v.string(), sourceUrl: v.string(), retrievedAt: v.number(), confidence: v.string(), notes: v.optional(v.string()),
  }).index("by_model", ["modelId", "retrievedAt"]).index("by_model_use_source", ["modelId", "commercialUse", "source"]),
  dataSnapshots: defineTable({ source: v.string(), sourceUrl: v.optional(v.string()), rawPayload: v.any(), payloadHash: v.string(), fetchedAt: v.number(), valid: v.boolean(), attribution: v.optional(v.string()), sourceVersion: v.optional(v.string()), metadata: v.optional(v.any()) })
    .index("by_source", ["source", "fetchedAt"]),
  syncRuns: defineTable({
    source: v.string(), status: v.string(), createdCount: v.number(), updatedCount: v.number(), failedCount: v.number(),
    recordsImported: v.optional(v.number()), unchanged: v.optional(v.boolean()), snapshotId: v.optional(v.id("dataSnapshots")),
    startedAt: v.number(), completedAt: v.optional(v.number()), error: v.optional(v.string()),
  }).index("by_source", ["source", "startedAt"]),
  plannerRuns: defineTable({
    strategyId: v.id("strategies"), provider: v.string(), model: v.optional(v.string()), status: v.union(v.literal("running"), v.literal("success"), v.literal("failed")),
    startedAt: v.number(), completedAt: v.optional(v.number()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
    failureStage: v.optional(v.string()),
  }).index("by_status", ["status", "startedAt"]),
  subscriptions: defineTable({
    userId: v.id("users"), stripeCustomerId: v.string(), stripeSubscriptionId: v.optional(v.string()), stripePriceId: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("plus"), v.literal("team"), v.literal("enterprise")), status: v.string(),
    currentPeriodEnd: v.optional(v.number()), cancelAtPeriodEnd: v.boolean(), updatedAt: v.number(),
  }).index("by_user", ["userId"]).index("by_customer", ["stripeCustomerId"]).index("by_subscription", ["stripeSubscriptionId"]),
  teams: defineTable({ ownerId: v.id("users"), name: v.string(), createdAt: v.number() }).index("by_owner", ["ownerId"]),
  teamMembers: defineTable({ teamId: v.id("teams"), userId: v.id("users"), role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")), createdAt: v.number() })
    .index("by_team", ["teamId"]).index("by_user", ["userId"]).index("by_team_user", ["teamId", "userId"]),
  webhookEvents: defineTable({ provider: v.string(), eventId: v.string(), eventType: v.string(), processedAt: v.number() })
    .index("by_provider_event", ["provider", "eventId"]),
});
