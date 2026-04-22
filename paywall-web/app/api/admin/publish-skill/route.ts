import { createHash } from "node:crypto";

import { NextRequest } from "next/server";

import { uploadSkillContent } from "@/lib/blob";
import { publishSkillVersion } from "@/lib/catalog";
import { validateConfiguredPrice } from "@/lib/l402";
import { errorResponse, jsonResponse, toManifest } from "@/lib/paywall";
import type { PublishSkillInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256Hex(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isAuthorized(request: NextRequest) {
  const token = process.env.ADMIN_PUBLISH_TOKEN;
  if (!token) {
    throw new Error("ADMIN_PUBLISH_TOKEN is required");
  }

  return request.headers.get("authorization") === `Bearer ${token}`;
}

function validateInput(value: unknown): value is PublishSkillInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.skillId === "string" &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.content === "string" &&
    typeof record.priceSats === "number"
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return errorResponse(request, 401, "unauthorized");
  }

  let input: PublishSkillInput;
  try {
    const payload = await request.json();
    if (!validateInput(payload)) {
      return errorResponse(request, 400, "invalid publish payload");
    }

    input = payload;
  } catch {
    return errorResponse(request, 400, "invalid json body");
  }

  if (!input.skillId || !input.title || !input.summary || !input.content) {
    return errorResponse(request, 400, "missing required fields");
  }

  const priceError = validateConfiguredPrice(input.priceSats);
  if (priceError) {
    return errorResponse(request, 400, priceError);
  }

  try {
    const contentSha256 = sha256Hex(input.content);
    const blobPath = await uploadSkillContent(
      input.skillId,
      contentSha256,
      input.content,
    );

    const skill = await publishSkillVersion({
      ...input,
      blobPath,
      contentSha256,
    });

    return jsonResponse(
      request,
      200,
      toManifest(skill),
      new Headers({ "Cache-Control": "no-store" }),
    );
  } catch (error) {
    console.error("publish-skill failed", error);
    return errorResponse(request, 500, "unable to publish skill");
  }
}
