import { anyApi } from "convex/server";
import { apiError, authenticatedConvex } from "@/lib/server/convex";
export async function GET(_:Request,{params}:{params:Promise<{strategyId:string}>}){try{const {strategyId}=await params;const client=await authenticatedConvex();return Response.json(await client.action(anyApi.actions.recommend.generate,{strategyId,region:"global"}));}catch(error){return apiError(error)}}
