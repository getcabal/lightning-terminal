import { NextRequest } from "next/server";

import { getSkillContentBlob } from "@/lib/blob";
import { getSkillVersion } from "@/lib/catalog";
import { issueL402Challenge, verifyL402Authorization } from "@/lib/l402";
import {
  challengeResponse,
  errorResponse,
  methodNotAllowed,
  paidContentPath,
  paidContentResponse,
  preflightResponse,
} from "@/lib/paywall";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ skillId: string; sha: string }>;
};

async function issueChallenge(
  request: NextRequest,
  skillId: string,
  sha: string,
) {
  const skill = await getSkillVersion(skillId, sha);
  if (!skill) {
    return errorResponse(request, 404, "unknown skill version");
  }

  try {
    const challenge = await issueL402Challenge({
      skillId: skill.skillId,
      contentSha256: skill.contentSha256,
      path: paidContentPath(skill.skillId, skill.contentSha256),
      method: "GET",
      priceSats: skill.priceSats,
    });

    return challengeResponse(request, challenge, skill);
  } catch (error) {
    console.error("failed to issue L402 challenge", error);
    return errorResponse(request, 503, "skill paywall unavailable");
  }
}

async function handleRequest(request: NextRequest, context: RouteContext) {
  const { skillId, sha } = await context.params;
  const skill = await getSkillVersion(skillId, sha);

  if (!skill) {
    return errorResponse(request, 404, "unknown skill version");
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return issueChallenge(request, skillId, sha);
  }

  let verification;
  try {
    verification = await verifyL402Authorization({
      authorization,
      expected: {
        skillId: skill.skillId,
        contentSha256: skill.contentSha256,
        path: paidContentPath(skill.skillId, skill.contentSha256),
        method: "GET",
      },
    });
  } catch (error) {
    console.error("failed to verify L402 authorization", error);
    return errorResponse(request, 503, "skill paywall unavailable");
  }

  if (!verification.valid) {
    console.warn("L402 verification failed", verification.reason);
    return issueChallenge(request, skillId, sha);
  }

  const blob = await getSkillContentBlob(skill.blobPath);
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return errorResponse(request, 404, "paid content unavailable");
  }

  return paidContentResponse(request, skill, blob.stream);
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
