"use client";

import { ArrowUpRight, DatabaseZap, PencilLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/client/api-error";
import { IntegrationNotice } from "./integration-notice";
import { integrationsConfigured } from "./providers";

type Evidence = { kind: string; source: string; sourceUrl: string | null; retrievedAt: number; modelVersion: string | null; metricName: string; rawValue: unknown; normalizedValue: number | null; category: string; confidence: string; notes: string | null };
type AccessOption = { label: string; url: string; modelId: string; sourceUrl: string; verifiedAt: number; productId?: string; productName?: string; planId?: string; planName?: string; accessMethod?: "product" | "api" | "marketplace" | "cloud"; monthlyPriceUsd?: number; aiFirstClass?: "AI_NATIVE" | "AI_CENTRIC" | "AI_ASSISTED" | "TRADITIONAL"; aiRole?: string; aiContributionLevel?: "LOW" | "MEDIUM" | "HIGH"; automationLevel?: "LOW" | "MEDIUM" | "HIGH"; requiredManualWork?: string };
type Tool = { model: Model; access: AccessOption; coversCapabilities: string[]; estimatedCostUsd: number; costBasis: string };
type Model = { canonicalId: string; name: string; provider: string; privacyLevel: string | null; commercialUse: boolean | null; contextWindow: number | null; accessOptions: AccessOption[] };
type Selected = { kind: "single" | "combination" | "partial"; model: Model; roundedScore: number; label: string; estimatedCostUsd: number; estimatedSavingsUsd: number; costBasis: string; explanation: string[]; limitations: string[]; evidence: Evidence[]; evidenceConfidence: "High" | "Moderate" | "Limited"; coveredCapabilities: string[]; missingCapabilities: string[]; tools: Tool[] };
type Options = { bestFit: Selected | null; budget: Selected | null; premium: Selected | null; fastest: Selected | null; privacy: Selected | null };
type Step = { stepId: string; step: { name: string; plainLanguageDescription: string; inputDescription: string; outputDescription: string; humanReviewRecommended: boolean; noAIEligible: boolean; noAIAlternative: string }; taskCategory: string; requiredCapabilities: string[]; selected: Selected | null; options: Options; alternatives: Selected[]; partialOptions: Selected[]; exclusions: Array<{ modelName: string; reasons: string[] }>; dataUpdatedAt: number | null };
type Subscription = { productId: string; productName: string; planName: string; accessMethod?: string; priceUsd: number | null; accessUrl: string; stepIds: string[]; stepNames: string[]; modelNames: string[]; alreadyOwned: boolean; additionalCostUsd: number | null; apiUsageEstimateUsd: number };
type Plan = { variant: string; steps: Step[]; fixedCostUsd: number; apiCostUsd: number; totalCostUsd: number; estimatedSavingsUsd: number; existingSubscriptions: { kept: string[]; couldCancel: string[] }; subscriptions: Subscription[]; uniqueProductCount: number; completeStepCount: number; budgetUsd?: number | null; overBudgetUsd?: number; hasUnknownSubscriptionPricing?: boolean; budgetCompatible?: boolean; budgetRemainingUsd?: number | null; inputsUsed?: { projectDescription: string | null; expectedResult: string | null; budgetUsd: number | null; deadline: string | null; priorityRanking: string[]; existingTools: string[]; informationSensitivity: string; commercialUse: boolean; providersToAvoid: string[]; preferredLanguage: string; expectedOutputs: string | null; region: string }; assumptions: string[]; dataUpdatedAt: number | null };
type SnapshotSource = { source: string; sourceUrl?: string; attribution?: string; fetchedAt: number; sourceVersion?: string };
type Result = { locked: boolean; usageType: "one_off" | "monthly"; estimatedCompletionTime?: string; plans: Plan[]; dataSnapshot: { fetchedAt: number; sources?: SnapshotSource[] } };

const tabLabels: Record<string, string> = { recommended: "BEST FIT", lowest_cost: "BUDGET", highest_quality: "PREMIUM", fastest: "FASTEST", privacy: "PRIVACY" };
const optionEntries: Array<[keyof Options, string]> = [["bestFit", "Best fit"], ["budget", "Budget"], ["premium", "Higher quality"], ["fastest", "Fastest"], ["privacy", "Privacy focused"]];

function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function friendlyCost(value: number) {
  if (value === 0) return "No extra cost";
  if (value < 0.01) return "Less than $0.01";
  return `$${value.toFixed(2)}`;
}
function candidateName(candidate: Selected | null) {
  if (!candidate) return "Not available";
  if (candidate.kind === "combination") return `${candidate.tools.length}-tool combination`;
  return candidate.model.name;
}

function StepOptions({ options }: { options: Options }) {
  return (
    <div className="mt-4 p-6 rounded-2xl bg-[#0e111d] border border-white/10 shadow-inner" aria-label="Options for this workflow step">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {optionEntries.map(([key, label]) => (
          <div key={key} className="option-col text-xs space-y-1">
            <span className="font-mono text-[10px] text-indigo-soft uppercase tracking-wider block mb-1">{label}</span>
            <strong className="block text-white text-sm font-semibold truncate">{candidateName(options[key])}</strong>
            {options[key] && (
              <div className="mt-1.5 flex items-center justify-between text-ink-2 text-[11px] pt-1">
                <span>{friendlyCost(options[key]!.estimatedCostUsd)}</span>
                <a href={options[key]!.tools[0].access.url} target="_blank" rel="noreferrer" className="text-indigo-300 inline-flex items-center gap-0.5 hover:underline font-medium">
                  View <ArrowUpRight className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolAccess({ tool }: { tool: Tool }) {
  const productName = tool.access.productName ?? tool.model.provider;
  const planName = tool.access.planName ?? (tool.access.accessMethod === "api" ? "Usage based API" : "Standard access");
  return (
    <div className="p-6 rounded-2xl bg-[#131626] border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6 my-4 shadow-md">
      <div className="tool-role flex-1 space-y-1.5">
        <strong className="text-white text-base font-semibold block leading-tight">{tool.model.name}</strong>
        <span className="block text-xs text-ink-2 leading-relaxed">{tool.access.aiRole ?? tool.coversCapabilities.map(humanize).join(" • ")}</span>
        <small className="text-[11px] font-mono text-ink-3 block pt-1">Manual work: {tool.access.requiredManualWork ?? "Review and refine output"}</small>
      </div>

      <div className="flex items-center gap-6 flex-none">
        <div className="text-left md:text-right space-y-0.5">
          <span className="block text-[10px] font-mono text-indigo-soft uppercase tracking-wider">Product / Plan</span>
          <strong className="text-xs text-white/90 font-medium block">{productName} • {planName}</strong>
        </div>

        <a className="btn-primary text-xs px-6 py-3 rounded-full inline-flex items-center gap-2 shadow-lg shadow-indigo-600/30 flex-none" href={tool.access.url} target="_blank" rel="noreferrer">
          <span>{tool.access.label}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function PartialOptions({ options }: { options: Selected[] }) {
  return (
    <div className="partial-options p-6 rounded-2xl bg-[#131626] border border-white/10 space-y-3 my-4">
      <h4 className="text-sm font-semibold text-white tracking-tight">{options.length ? "PARTIAL OPTIONS AVAILABLE" : "NO COMPLETE AI MATCH YET"}</h4>
      <p className="text-xs text-ink-2 leading-relaxed">We&apos;re checking whether a combination of AI tools can cover this step.</p>
      <div className="space-y-3 pt-2">
        {options.map((option) => (
          <div key={option.model.canonicalId} className="text-xs p-4 rounded-xl bg-white/5 border border-white/10 space-y-1">
            <strong className="text-white font-semibold block">{option.model.name}</strong>
            <span className="block text-ink-3 text-[11px]">Covers: {option.coveredCapabilities.map(humanize).join(", ") || "None verified"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResultsView({ strategyId }: { strategyId: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("recommended");
  const [loadedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!integrationsConfigured) return;
    const cached = sessionStorage.getItem(`benchflow:result:${strategyId}`);
    let request: Promise<Result>;
    if (cached) {
      sessionStorage.removeItem(`benchflow:result:${strategyId}`);
      try { request = Promise.resolve(JSON.parse(cached) as Result); }
      catch { request = fetchResult(); }
    } else request = fetchResult();
    request.then(setResult).catch((reason) => setError(reason instanceof Error ? reason.message : "Results unavailable"));
    function fetchResult() {
      return fetch(`/api/strategies/${strategyId}/results`).then(async (response) => {
        const body = (await response.json()) as Result | { code?: string; userMessage?: string; error?: string };
        if (!response.ok) throw new Error(apiErrorMessage(body, "We couldn't load recommendations right now."));
        return body as Result;
      });
    }
  }, [strategyId]);

  if (!integrationsConfigured) return <IntegrationNotice />;
  if (error) return (
    <div className="glass-card text-center py-12 p-8 rounded-3xl border border-white/10">
      <DatabaseZap className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
      <h2 className="text-xl font-semibold text-white">STRATEGY TEMPORARILY UNAVAILABLE</h2>
      <p className="text-xs text-ink-2 mt-2">{error}. Your previous strategy is still safe.</p>
    </div>
  );
  if (!result) return (
    <div className="glass-card text-center py-16 p-8 rounded-3xl border border-white/10">
      <div className="w-3 h-3 rounded-full bg-indigo-400 animate-ping mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-white">MATCHING OPTIMAL AI STACK</h2>
      <p className="text-xs text-ink-2 mt-2">AIssessor is verifying primary benchmark evidence and calculating subscription costs.</p>
    </div>
  );

  const plan = result.plans.find((item) => item.variant === tab) ?? result.plans[0];
  const stale = loadedAt - result.dataSnapshot.fetchedAt > 7 * 86_400_000;
  const subscriptions = plan.subscriptions ?? [];
  const inputs = plan.inputsUsed;
  const budgetConfigured = plan.budgetUsd !== null && plan.budgetUsd !== undefined;
  const costPeriod = result.usageType === "monthly" ? "Estimated monthly total" : "First-month project total";

  return (
    <div className="w-full max-w-6xl mx-auto my-auto py-6 space-y-8">
      {/* Header Matching Presentation Deck Style */}
      <div className="s-compare-head flex flex-col items-center justify-center text-center space-y-3">
        <div className="eyebrow justify-center">
          <span className="dt" />
          AI Strategy Results
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-white tracking-tight text-center max-w-[700px] mx-auto leading-tight">
          Your Compatible AI Stack
        </h1>
        <p className="text-xs text-ink-2 text-center max-w-xl mx-auto leading-relaxed pt-1">
          Each option is matched to your workload, checked against current primary evidence, and saved to your account.
        </p>
      </div>

      {/* 30px Spacer Div */}
      <div className="h-[30px] w-full block" />

      {/* Strategy Variant Switcher Bar */}
      <div className="flex items-center justify-between border-b border-white/10 pb-6 flex-wrap gap-4">
        <div>
          <span className="text-xs font-mono font-bold text-indigo-soft uppercase tracking-wider block mb-1">
            Strategy Variant
          </span>
          <h2 className="text-2xl font-semibold text-white font-sans tracking-tight">
            AI Stack Roadmap
          </h2>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded-full bg-white/5 border border-white/10">
          {result.plans.map((item) => (
            <button
              key={item.variant}
              className={`px-5 py-2 rounded-full font-mono text-xs font-bold transition-all ${
                tab === item.variant
                  ? "bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-lg shadow-indigo-500/25"
                  : "text-ink-2 hover:text-white"
              }`}
              onClick={() => setTab(item.variant)}
            >
              {tabLabels[item.variant] ?? humanize(item.variant)}
            </button>
          ))}
        </div>
      </div>

      {stale && <span className="font-mono text-xs text-amber-400 bg-amber-400/10 px-4 py-1.5 rounded-full border border-amber-400/20 block w-max">DATA LAST UPDATED &gt; 7 DAYS AGO</span>}

      <section className="glass-card p-6 md:p-8 rounded-3xl border border-white/10 space-y-6" aria-label="Requirements used for this recommendation">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <span className="font-mono text-[10px] text-indigo-soft uppercase tracking-wider">YOUR REQUIREMENTS WERE APPLIED</span>
            <h2 className="text-xl font-semibold text-white mt-1">Budget and input check</h2>
            <p className="text-xs text-ink-2 mt-2 max-w-2xl">The selected stack must satisfy the complete workflow and stay inside the total budget. New subscriptions without a verified price are not treated as free.</p>
          </div>
          {budgetConfigured && (
            <span className={`font-mono text-xs font-bold px-4 py-2 rounded-full border ${plan.budgetCompatible !== false ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" : "text-amber-300 bg-amber-400/10 border-amber-400/30"}`}>
              {plan.budgetCompatible !== false ? "WITHIN BUDGET" : "NO COMPLETE STACK FITS"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10"><span className="block text-[10px] font-mono text-ink-3 uppercase">Budget cap</span><strong className="block text-white mt-1">{budgetConfigured ? friendlyCost(plan.budgetUsd!) : "Not set"}</strong></div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10"><span className="block text-[10px] font-mono text-ink-3 uppercase">Projected total</span><strong className="block text-white mt-1">{friendlyCost(plan.totalCostUsd)}</strong></div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10"><span className="block text-[10px] font-mono text-ink-3 uppercase">Language</span><strong className="block text-white mt-1">{inputs?.preferredLanguage ?? "English"}</strong></div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10"><span className="block text-[10px] font-mono text-ink-3 uppercase">Information</span><strong className="block text-white mt-1">{humanize(inputs?.informationSensitivity ?? "standard")}</strong></div>
        </div>
        {inputs && <details className="text-xs text-ink-2"><summary className="font-mono font-semibold text-indigo-soft cursor-pointer">View every input used</summary><div className="grid md:grid-cols-2 gap-3 mt-4 p-4 rounded-2xl bg-white/5 border border-white/10"><p><strong className="text-white">Priority order:</strong> {inputs.priorityRanking.map(humanize).join(" → ")}</p><p><strong className="text-white">Deadline:</strong> {inputs.deadline ?? "No deadline"}</p><p><strong className="text-white">Commercial use:</strong> {inputs.commercialUse ? "Required" : "Not required"}</p><p><strong className="text-white">Existing tools:</strong> {inputs.existingTools.join(", ") || "None provided"}</p><p><strong className="text-white">Providers avoided:</strong> {inputs.providersToAvoid.join(", ") || "None"}</p><p><strong className="text-white">Expected outputs:</strong> {inputs.expectedOutputs ?? "Defined by the approved workflow"}</p></div></details>}
      </section>

      {/* 20px Spacer Div */}
      <div className="h-[20px] w-full block" />

      {/* Workflow Steps Roadmap Cards (Spaced 32px apart) */}
      <div className="space-y-8">
        {plan.steps.map((step, index) => (
          <article className="glass-card p-8 rounded-3xl space-y-6 border border-white/10 relative shadow-xl overflow-hidden" key={step.stepId}>
            {/* Step Header Row */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs font-bold text-indigo-soft tracking-widest uppercase">
                STEP {String(index + 1).padStart(2, "0")} / {String(plan.steps.length).padStart(2, "0")} • {humanize(step.taskCategory ?? "WORKFLOW")}
              </span>
              {step.selected && (
                <span className="font-mono text-[10px] text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/30 font-semibold uppercase tracking-wider">
                  {step.selected.evidenceConfidence ? `${step.selected.evidenceConfidence} Evidence` : step.selected.label}
                </span>
              )}
            </div>

            {/* Title & Cost Row */}
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1 flex-1">
                <h3 className="text-xl font-semibold text-white tracking-tight leading-snug">{step.step.name}</h3>
                <p className="text-xs text-ink-2 leading-relaxed">{step.step.plainLanguageDescription}</p>
              </div>

              {step.selected && (
                <div className="text-right flex-none">
                  <span className="font-mono text-[10px] text-ink-3 uppercase block tracking-wider mb-1">ESTIMATED USAGE</span>
                  <strong className="text-xl font-bold text-white font-sans">{friendlyCost(step.selected.estimatedCostUsd)}</strong>
                </div>
              )}
            </div>

            {/* Selected Tool Details */}
            {step.selected ? (
              <div className="space-y-4 pt-2">
                <div className="tool-access-list space-y-4">
                  {step.selected.tools.map((tool) => (
                    <ToolAccess key={`${tool.model.canonicalId}-${tool.access.productId ?? tool.access.modelId}`} tool={tool} />
                  ))}
                </div>

                {step.options && (
                  <details className="text-xs text-ink-2 cursor-pointer pt-2">
                    <summary className="font-mono font-semibold text-indigo-soft hover:underline tracking-wide">▶ Compare Alternative Tools</summary>
                    <StepOptions options={step.options} />
                  </details>
                )}
              </div>
            ) : step.step.noAIEligible ? (
              <div className="p-6 rounded-2xl bg-[#131626] border border-white/10 space-y-1 my-4">
                <strong className="text-sm font-semibold text-white block">No AI Needed</strong>
                <p className="text-xs text-ink-2 leading-relaxed">{step.step.noAIAlternative}</p>
              </div>
            ) : (
              <div>
                <PartialOptions options={step.partialOptions ?? []} />
                {budgetConfigured && <p className="text-xs text-amber-300 mt-3">No verified complete option for this step fits the total ${plan.budgetUsd!.toFixed(2)} budget with the other workflow steps.</p>}
              </div>
            )}
          </article>
        ))}
      </div>

      {/* 30px Spacer Div */}
      <div className="h-[30px] w-full block" />

      {/* Consolidated Subscription Stack & Savings Section */}
      <section className="glass-card p-8 rounded-3xl border border-indigo-500/30 bg-gradient-to-b from-[#131626] to-[#0b0d17] space-y-6 shadow-xl">
        <div className="flex items-center justify-between pb-6 border-b border-white/10 flex-wrap gap-4">
          <div>
            <div className="eyebrow mb-2">
              <span className="dt" />
              CONSOLIDATED SUBSCRIPTION STACK
            </div>
            <h2 className="text-2xl font-semibold text-white tracking-tight">Your Optimized AI Stack</h2>
          </div>

          <div className="text-right">
            <span className="font-mono text-xs text-ink-3 uppercase block tracking-wider mb-1">{plan.estimatedSavingsUsd > 0 ? "VERIFIED SAVINGS" : costPeriod}</span>
            <span className="text-3xl font-bold text-indigo-soft tracking-tight">
              {plan.estimatedSavingsUsd > 0 ? `${friendlyCost(plan.estimatedSavingsUsd)} saved` : friendlyCost(plan.totalCostUsd)}
            </span>
          </div>
        </div>

        {subscriptions.length ? (
          <div className="space-y-6">
            <div className="space-y-4">
              {subscriptions.map((sub) => (
                <div key={sub.productId} className="flex items-center justify-between p-6 rounded-2xl bg-white/5 border border-white/10 gap-6">
                  <div className="space-y-1">
                    <strong className="text-base font-semibold text-white block">{sub.productName}</strong>
                    <span className="block text-xs text-ink-2">{sub.planName} • Used for {sub.stepNames.join(", ")}</span>
                  </div>
                  <div className="text-right flex-none space-y-1">
                    <strong className="text-base font-bold text-white block">{sub.accessMethod === "product" ? (sub.priceUsd === null ? "Price not verified" : `$${sub.priceUsd.toFixed(2)}/mo`) : `${friendlyCost(sub.apiUsageEstimateUsd)} usage`}</strong>
                    <a href={sub.accessUrl} target="_blank" rel="noreferrer" className="block text-xs text-indigo-soft hover:underline font-medium">
                      View Plan &rarr;
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5 rounded-2xl bg-gradient-to-r from-indigo-500/10 to-pink-500/10 border border-indigo-500/30">
              <div><span className="block text-[10px] font-mono text-ink-3 uppercase">New subscriptions</span><strong className="text-lg text-white">{friendlyCost(plan.fixedCostUsd)} / month</strong></div>
              <div><span className="block text-[10px] font-mono text-ink-3 uppercase">Estimated API usage</span><strong className="text-lg text-white">{friendlyCost(plan.apiCostUsd)}</strong></div>
              <div><span className="block text-[10px] font-mono text-indigo-soft uppercase">{costPeriod}</span><strong className="text-lg text-white">{friendlyCost(plan.totalCostUsd)}</strong></div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-2 p-4">No paid AI products required for this workflow.</p>
        )}
      </section>

      {/* 20px Spacer Div */}
      <div className="h-[20px] w-full block" />

      {/* Footer Actions Row */}
      <div className="flex items-center justify-between pt-6 border-t border-white/10 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 flex-none" />
          <span className="text-xs text-ink-2">
            <strong className="text-white font-semibold">Saved to your account</strong> • Access anytime from your command center dashboard.
          </span>
        </div>

        <Link className="btn-secondary text-xs px-6 py-3 rounded-full inline-flex items-center gap-2" href={`/strategy/${strategyId}/workflow`}>
          <PencilLine className="w-3.5 h-3.5" />
          <span>Edit workflow</span>
        </Link>
      </div>
    </div>
  );
}
