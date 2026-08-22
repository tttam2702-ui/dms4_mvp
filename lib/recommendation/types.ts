import type { Priority, WorkflowStep } from "@/lib/planner/schema";
import type { Capability, TaskCategory } from "./taxonomy";
import type { AiFirstMetadata } from "./ai-first";

export type EvidenceReference = {
  kind: "benchmark" | "capability" | "pricing" | "privacy" | "license";
  source: string; sourceUrl: string | null; retrievedAt: number; modelVersion: string | null;
  metricName: string; rawValue: unknown; normalizedValue: number | null; category: string;
  confidence: string; notes: string | null;
};

export type ModelAccessOption = AiFirstMetadata & {
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

export type CanonicalModel = AiFirstMetadata & {
  id: string; canonicalId?: string; name: string; provider: string; active: boolean; modalities: string[]; capabilities: string[];
  contextWindow: number | null; inputPricePerMillion: number | null; outputPricePerMillion: number | null;
  imagePricePerThousand?: number | null; videoPricePerMinute?: number | null; audioPricePerMinute?: number | null;
  speechPricePerMillionCharacters?: number | null;
  qualityScore: number | null; outputTokensPerSecond: number | null;
  privacyLevel: "standard" | "business" | "sensitive" | "restricted" | null; commercialUse: boolean | null;
  regions: string[]; source: string; sourceUrl?: string | null; measuredAt: number | null; retrievedAt: number;
  existingTool: boolean; evidence?: EvidenceReference[];
  mappingConfidence?: "exact" | "explicit_alias" | "unmatched";
  accessOptions?: ModelAccessOption[];
};

export type Exclusion = { modelId: string; modelName: string; reasons: string[] };
export type FitLabel = "Strong Fit" | "Good Fit" | "Possible Fit" | "Limited Evidence";
export type CandidateScore = {
  kind: "single" | "combination" | "partial";
  model: CanonicalModel; roundedScore: number; label: FitLabel; estimatedCostUsd: number; estimatedSavingsUsd: number;
  costBasis: string; explanation: string[]; limitations: string[]; evidence: EvidenceReference[]; evidenceConfidence: "High" | "Moderate" | "Limited";
  qualityScore: number;
  speedScore: number;
  privacyScore: number;
  workflowFriction: number;
  coveredCapabilities: Capability[];
  missingCapabilities: Capability[];
  tools: Array<{
    model: CanonicalModel;
    access: ModelAccessOption;
    coversCapabilities: Capability[];
    estimatedCostUsd: number;
    costBasis: string;
  }>;
};
export type StepOptionSet = {
  bestFit: CandidateScore | null;
  budget: CandidateScore | null;
  premium: CandidateScore | null;
  fastest: CandidateScore | null;
  privacy: CandidateScore | null;
};
export type StepRecommendation = {
  stepId: string;
  step: Pick<WorkflowStep, "name" | "plainLanguageDescription" | "inputDescription" | "outputDescription" | "humanReviewRecommended" | "noAIEligible" | "noAIAlternative">;
  taskCategory: TaskCategory;
  requiredCapabilities: Capability[];
  selected: CandidateScore | null;
  options: StepOptionSet;
  alternatives: CandidateScore[];
  partialOptions: CandidateScore[];
  exclusions: Exclusion[];
  dataUpdatedAt: number | null;
};
export type RecommendationContext = {
  priorities: Priority[];
  budgetUsd: number | null;
  region: string;
  now: number;
  existingTools?: string[];
  usageType?: "one_off" | "monthly";
  deadline?: string;
  projectDescription?: string;
  expectedResult?: string;
  informationSensitivity?: string;
  commercialUse?: boolean;
  providersToAvoid?: string[];
  preferredLanguage?: string;
  expectedOutputs?: string;
};
export type StrategyVariant = "recommended" | "lowest_cost" | "highest_quality" | "fastest" | "privacy";
export type SubscriptionSummary = {
  productId: string;
  productName: string;
  planName: string;
  accessMethod: ModelAccessOption["accessMethod"];
  priceUsd: number | null;
  accessUrl: string;
  stepIds: string[];
  stepNames: string[];
  modelNames: string[];
  alreadyOwned: boolean;
  additionalCostUsd: number | null;
  apiUsageEstimateUsd: number;
};
export type StrategyPlan = {
  variant: StrategyVariant; steps: StepRecommendation[]; fixedCostUsd: number; apiCostUsd: number; totalCostUsd: number;
  estimatedSavingsUsd: number; existingSubscriptions: { kept: string[]; couldCancel: string[] };
  subscriptions: SubscriptionSummary[];
  uniqueProductCount: number;
  completeStepCount: number;
  budgetUsd: number | null;
  overBudgetUsd: number;
  hasUnknownSubscriptionPricing: boolean;
  budgetCompatible: boolean;
  budgetRemainingUsd: number | null;
  inputsUsed: {
    projectDescription: string | null;
    expectedResult: string | null;
    budgetUsd: number | null;
    deadline: string | null;
    priorityRanking: Priority[];
    existingTools: string[];
    informationSensitivity: string;
    commercialUse: boolean;
    providersToAvoid: string[];
    preferredLanguage: string;
    expectedOutputs: string | null;
    region: string;
  };
  assumptions: string[]; dataUpdatedAt: number | null;
};
export type RecommendationRequest = { steps: WorkflowStep[]; models: CanonicalModel[]; context: RecommendationContext };
