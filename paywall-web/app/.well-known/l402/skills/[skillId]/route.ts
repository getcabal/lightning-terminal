import { NextRequest } from "next/server";

import { getCurrentSkillVersion } from "@/lib/catalog";
import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  preflightResponse,
  toManifest,
} from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ skillId: string }>;
};

async function handleRequest(request: NextRequest, context: RouteContext) {
  const { skillId } = await context.params;
  const skill = await getCurrentSkillVersion(skillId);

  if (!skill) {
    return errorResponse(request, 404, "unknown skill");
  }

  const headers = new Headers({
    Allow: "GET, HEAD, OPTIONS",
    "Cache-Control": "public, max-age=300",
  });

  return jsonResponse(request, 200, toManifest(skill), headers);
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(request: NextRequest) {
  return methodNotAllowed(request);
}
