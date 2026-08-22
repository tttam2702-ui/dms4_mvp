import { anyApi } from "convex/server";
import { StrategyInputSchema } from "@/lib/planner/schema";
import { apiError, authenticatedConvex } from "@/lib/server/convex";
import { budgetToUsd } from "@/lib/currency";
import { generateMonthlyRecommendations } from "@/lib/server/workflow-generation";

export async function GET(){try{const client=await authenticatedConvex();return Response.json(await client.query(anyApi.strategies.listMine,{}));}catch(error){return apiError(error)}}
export async function POST(request:Request){try{
  const input=StrategyInputSchema.parse(await request.json());const client=await authenticatedConvex();
  const oneOff=input.usageType==="one_off";
  const description=oneOff?input.projectBrief:input.monthlyTasks.map((task)=>`${task.task} (${task.frequency}, ${task.quality})`).join("; ");
  const priorities=input.priorities;
  const strategyId=await client.mutation(anyApi.strategies.create,{
    usageType:input.usageType,title:(oneOff?input.projectBrief:input.monthlyTasks[0].task).slice(0,70),originalInput:description,
    expectedResult:oneOff?input.projectBrief:"A recurring monthly AI workflow for every listed task",
    deadline:oneOff?input.deadline:undefined,
    budget:oneOff?budgetToUsd(input.budgetAmount,input.budgetCurrency)??undefined:undefined,
    budgetAmount:oneOff?input.budgetAmount??undefined:undefined,budgetCurrency:oneOff?input.budgetCurrency:undefined,
    monthlyTasks:oneOff?undefined:input.monthlyTasks,existingTools:input.existingTools,priorities,
    informationSensitivity:input.optionalContext.informationSensitivity,
    commercialUse:input.optionalContext.commercialUse,
    providersToAvoid:input.optionalContext.providersToAvoid,
    preferredLanguage:input.optionalContext.preferredLanguage,
    expectedOutputs:input.optionalContext.expectedOutputs||undefined,
  });
  const analysis=await client.action(anyApi.actions.planner.analyse,{strategyId,input});
  const result=await generateMonthlyRecommendations(client,strategyId,input.usageType);
  return Response.json({strategyId,analysis,...(result?{result}:{})});
}catch(error){return apiError(error)}}
