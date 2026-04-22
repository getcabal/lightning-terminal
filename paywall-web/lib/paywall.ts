import { NextRequest, NextResponse } from "next/server";

import {
  MANIFEST_ROOT,
  MARKDOWN_CONTENT_TYPE,
  PURCHASE_MODEL,
} from "@/lib/constants";
import type {
  L402Challenge,
  PublishedSkillVersion,
  SkillManifest,
} from "@/lib/types";

export function manifestPath(skillId: string) {
  return `${MANIFEST_ROOT}/${skillId}`;
}

export function paidContentPath(skillId: string, contentSha256: string) {
  return `${manifestPath(skillId)}/v/${contentSha256}/content`;
}

export function toManifest(skill: PublishedSkillVersion): SkillManifest {
  return {
    skill_id: skill.skillId,
    title: skill.title,
    summary: skill.summary,
    purchase_model: PURCHASE_MODEL,
    price_sats: skill.priceSats,
    content_sha256: skill.contentSha256,
    manifest_url: manifestPath(skill.skillId),
    paid_url: paidContentPath(skill.skillId, skill.contentSha256),
    content_type: MARKDOWN_CONTENT_TYPE,
  };
}

function addCorsHeaders(headers: Headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, WWW-Authenticate",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "WWW-Authenticate, ETag, X-Skill-Version",
  );
}

export function preflightResponse() {
  const headers = new Headers();
  addCorsHeaders(headers);
  headers.set("Allow", "GET, HEAD, OPTIONS");
  return new NextResponse(null, { status: 204, headers });
}

export function jsonResponse(
  request: NextRequest,
  status: number,
  body: unknown,
  initHeaders?: HeadersInit,
) {
  const headers = new Headers(initHeaders);
  addCorsHeaders(headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new NextResponse(
    request.method === "HEAD" ? null : JSON.stringify(body),
    { status, headers },
  );
}

export function errorResponse(
  request: NextRequest,
  status: number,
  message: string,
  initHeaders?: HeadersInit,
) {
  const headers = new Headers(initHeaders);
  headers.set("Cache-Control", "no-store");
  return jsonResponse(request, status, { error: message }, headers);
}

export function methodNotAllowed(request: NextRequest) {
  const headers = new Headers({ Allow: "GET, HEAD, OPTIONS" });
  return errorResponse(request, 405, "method not allowed", headers);
}

export function challengeResponse(
  request: NextRequest,
  challenge: L402Challenge,
  skill: PublishedSkillVersion,
) {
  const headers = new Headers({
    Allow: "GET, HEAD, OPTIONS",
    "Cache-Control": "private, no-store",
  });

  for (const authHeader of challenge.headers) {
    headers.append("WWW-Authenticate", authHeader);
  }

  return jsonResponse(
    request,
    402,
    {
      error: "payment_required",
      skill_id: skill.skillId,
      purchase_model: PURCHASE_MODEL,
      price_sats: skill.priceSats,
      content_sha256: skill.contentSha256,
      paid_url: paidContentPath(skill.skillId, skill.contentSha256),
    },
    headers,
  );
}

export function paidContentResponse(
  request: NextRequest,
  skill: PublishedSkillVersion,
  stream: ReadableStream | null,
) {
  const headers = new Headers({
    Allow: "GET, HEAD, OPTIONS",
    "Cache-Control": "private, no-store",
    "Content-Type": MARKDOWN_CONTENT_TYPE,
    ETag: `"${skill.contentSha256}"`,
    "X-Skill-Version": skill.contentSha256,
  });

  addCorsHeaders(headers);

  return new NextResponse(request.method === "HEAD" ? null : stream, {
    status: 200,
    headers,
  });
}
