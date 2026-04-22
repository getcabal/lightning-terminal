import { createHash } from "node:crypto";

import {
  base64ToBytes,
  bytesToBase64,
  importMacaroon,
  newMacaroon,
} from "macaroon";

import { getOptionalDb } from "@/lib/db";
import type { L402Challenge, L402Verification } from "@/lib/types";

const DEFAULT_INVOICE_EXPIRY_SECONDS = 3600;
const DEFAULT_MIN_AMOUNT_SATS = 1;
const DEFAULT_MAX_AMOUNT_SATS = 100_000;
const FIELD_EOS = 0;
const FIELD_LOCATION = 1;
const FIELD_IDENTIFIER = 2;
const FIELD_VID = 4;
const FIELD_SIGNATURE = 6;
const textEncoder = new TextEncoder();

type ChallengeInput = {
  skillId: string;
  contentSha256: string;
  path: string;
  method: string;
  priceSats: number;
};

type VerifyInput = {
  authorization: string;
  expected: {
    skillId: string;
    contentSha256: string;
    path: string;
    method: string;
  };
};

type CreateInvoiceResponse = {
  payment_request?: string;
  payment_request_rune?: string;
  r_hash?: string;
  r_hash_str?: string;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function getLightningNodeUrl() {
  const nodeType = (process.env.LIGHTNING_NODE_TYPE ?? "lnd").trim().toLowerCase();
  if (nodeType !== "lnd") {
    throw new Error(`unsupported LIGHTNING_NODE_TYPE: ${nodeType}`);
  }

  const baseUrl = requireEnv("LIGHTNING_NODE_URL");
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function getLightningApiKey() {
  return requireEnv("LIGHTNING_API_KEY");
}

function parseOptionalInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function getInvoiceExpirySeconds() {
  return parseOptionalInt("L402_INVOICE_EXPIRY", DEFAULT_INVOICE_EXPIRY_SECONDS);
}

function getAmountRange() {
  const min = parseOptionalInt("L402_MIN_AMOUNT_SATS", DEFAULT_MIN_AMOUNT_SATS);
  const max = parseOptionalInt("L402_MAX_AMOUNT_SATS", DEFAULT_MAX_AMOUNT_SATS);

  if (min > max) {
    throw new Error("L402_MIN_AMOUNT_SATS must be less than or equal to L402_MAX_AMOUNT_SATS");
  }

  return { min, max };
}

export function validateConfiguredPrice(priceSats: number) {
  if (!Number.isInteger(priceSats) || priceSats <= 0) {
    return "priceSats must be a positive integer";
  }

  const { min, max } = getAmountRange();
  if (priceSats < min || priceSats > max) {
    return `priceSats must be between ${min} and ${max}`;
  }

  return null;
}

function getMacaroonRootKey() {
  const hex = requireEnv("L402_MACAROON_ROOT_KEY");
  if (!/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("L402_MACAROON_ROOT_KEY must be hex encoded");
  }

  const rootKey = Buffer.from(hex, "hex");
  if (rootKey.length !== 32) {
    throw new Error("L402_MACAROON_ROOT_KEY must decode to 32 bytes");
  }

  return rootKey;
}

function invoiceMemo(skillId: string, contentSha256: string) {
  return `L402 ${skillId}@${contentSha256.slice(0, 12)}`;
}

async function createInvoice(priceSats: number, skillId: string, contentSha256: string) {
  const response = await fetch(`${getLightningNodeUrl()}/v1/invoices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Grpc-Metadata-macaroon": getLightningApiKey(),
    },
    body: JSON.stringify({
      value: priceSats.toString(),
      memo: invoiceMemo(skillId, contentSha256),
      expiry: getInvoiceExpirySeconds().toString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as CreateInvoiceResponse) : {};

  if (!response.ok) {
    throw new Error(`invoice creation failed: ${response.status} ${text}`);
  }

  const invoice = data.payment_request ?? data.payment_request_rune;
  if (!invoice) {
    throw new Error("invoice creation response missing payment_request");
  }

  let paymentHash: string | null = null;
  if (data.r_hash) {
    paymentHash = Buffer.from(data.r_hash, "base64").toString("hex");
  } else if (data.r_hash_str) {
    paymentHash = data.r_hash_str.toLowerCase();
  }

  if (!paymentHash || !/^[0-9a-f]{64}$/i.test(paymentHash)) {
    throw new Error("invoice creation response missing a valid payment hash");
  }

  return { invoice, paymentHash };
}

function caveatsFor(expected: {
  skillId: string;
  contentSha256: string;
  path: string;
  method: string;
}) {
  return [
    `skill_id = ${expected.skillId}`,
    `content_sha256 = ${expected.contentSha256}`,
    `path = ${expected.path}`,
    `method = ${expected.method.toUpperCase()}`,
  ];
}

type ExportedMacaroonJson = {
  v?: number;
  i?: string;
  i64?: string;
  l?: string;
  s?: string;
  s64?: string;
  c?: Array<{
    i?: string;
    i64?: string;
    l?: string;
    v?: string;
    v64?: string;
  }>;
};

function utf8Bytes(value: string) {
  return textEncoder.encode(value);
}

function encodeVarint(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid varint value: ${value}`);
  }

  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}

function appendField(buffer: number[], fieldType: number, data?: Uint8Array) {
  buffer.push(fieldType);
  if (fieldType === FIELD_EOS) {
    return;
  }
  if (!data) {
    throw new Error(`field ${fieldType} requires data`);
  }

  buffer.push(...encodeVarint(data.length));
  buffer.push(...data);
}

function jsonFieldBytes(
  value: Record<string, unknown>,
  key: string,
  required = true,
): Uint8Array | null {
  const utf8Value = value[key];
  if (typeof utf8Value === "string") {
    return utf8Bytes(utf8Value);
  }

  const base64Value = value[`${key}64`];
  if (typeof base64Value === "string") {
    return base64ToBytes(base64Value);
  }

  if (!required) {
    return null;
  }

  throw new Error(`macaroon JSON is missing field ${key}`);
}

function requireJsonFieldBytes(value: Record<string, unknown>, key: string) {
  const bytes = jsonFieldBytes(value, key);
  if (!bytes) {
    throw new Error(`macaroon JSON is missing field ${key}`);
  }

  return bytes;
}

function exportBinaryV2FromJson(value: ExportedMacaroonJson) {
  if (value.v !== 2) {
    throw new Error(`unsupported macaroon export version: ${String(value.v)}`);
  }

  const buffer: number[] = [2];

  if (value.l) {
    appendField(buffer, FIELD_LOCATION, utf8Bytes(value.l));
  }

  appendField(buffer, FIELD_IDENTIFIER, requireJsonFieldBytes(value, "i"));
  appendField(buffer, FIELD_EOS);

  for (const caveat of value.c ?? []) {
    if (caveat.l) {
      appendField(buffer, FIELD_LOCATION, utf8Bytes(caveat.l));
    }

    appendField(buffer, FIELD_IDENTIFIER, requireJsonFieldBytes(caveat, "i"));

    const verificationId = jsonFieldBytes(caveat, "v", false);
    if (verificationId) {
      appendField(buffer, FIELD_VID, verificationId);
    }

    appendField(buffer, FIELD_EOS);
  }

  appendField(buffer, FIELD_EOS);
  appendField(buffer, FIELD_SIGNATURE, requireJsonFieldBytes(value, "s"));
  return Uint8Array.from(buffer);
}

function mintMacaroon(input: {
  paymentHash: string;
  skillId: string;
  contentSha256: string;
  path: string;
  method: string;
}) {
  const macaroon = newMacaroon({
    version: 2,
    rootKey: getMacaroonRootKey(),
    identifier: utf8Bytes(input.paymentHash),
    location: "l402.lightningnode.app",
  });

  for (const caveat of caveatsFor(input)) {
    macaroon.addFirstPartyCaveat(utf8Bytes(caveat));
  }

  return bytesToBase64(
    exportBinaryV2FromJson(macaroon.exportJSON() as ExportedMacaroonJson),
  );
}

function parseAuthorizationHeader(authorization: string) {
  const [scheme, credential] = authorization.trim().split(/\s+/, 2);
  if (!scheme || !credential) {
    throw new Error("malformed authorization header");
  }

  const normalizedScheme = scheme.toUpperCase();
  if (normalizedScheme !== "L402" && normalizedScheme !== "LSAT") {
    throw new Error("unsupported authorization scheme");
  }

  const separator = credential.indexOf(":");
  if (separator === -1) {
    throw new Error("authorization header missing preimage");
  }

  const macaroonB64 = credential.slice(0, separator);
  const preimageHex = credential.slice(separator + 1).toLowerCase();
  if (!macaroonB64 || !/^[0-9a-f]{64}$/i.test(preimageHex)) {
    throw new Error("authorization header is invalid");
  }

  return { macaroonB64, preimageHex };
}

function verifyMacaroonCaveats(
  macaroonB64: string,
  expected: VerifyInput["expected"],
) {
  const macaroon = importMacaroon(macaroonB64);
  const expectedCaveats = new Set(caveatsFor(expected));
  const seenCaveats = new Set<string>();

  macaroon.verify(
    getMacaroonRootKey(),
    (condition: string) => {
      if (!expectedCaveats.has(condition)) {
        return `unexpected caveat: ${condition}`;
      }

      seenCaveats.add(condition);
      return null;
    },
    [],
  );

  for (const caveat of expectedCaveats) {
    if (!seenCaveats.has(caveat)) {
      throw new Error(`missing caveat: ${caveat}`);
    }
  }

  const paymentHash = Buffer.from(macaroon.identifier).toString("utf8").toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(paymentHash)) {
    throw new Error("macaroon identifier does not contain a valid payment hash");
  }

  return paymentHash;
}

function paymentHashForPreimage(preimageHex: string) {
  return createHash("sha256")
    .update(Buffer.from(preimageHex, "hex"))
    .digest("hex");
}

async function recordChallenge(input: {
  paymentHash: string;
  skillId: string;
  contentSha256: string;
  priceSats: number;
  invoice: string;
}) {
  const db = getOptionalDb();
  if (!db) {
    return;
  }

  await db.query(
    `
      insert into l402_challenges (
        payment_hash,
        skill_id,
        content_sha256,
        price_sats,
        invoice
      ) values ($1, $2, $3, $4, $5)
      on conflict (payment_hash) do update
      set
        skill_id = excluded.skill_id,
        content_sha256 = excluded.content_sha256,
        price_sats = excluded.price_sats,
        invoice = excluded.invoice
    `,
    [
      input.paymentHash,
      input.skillId,
      input.contentSha256,
      input.priceSats,
      input.invoice,
    ],
  );
}

async function recordReceipt(input: {
  paymentHash: string;
  skillId: string;
  contentSha256: string;
}) {
  const db = getOptionalDb();
  if (!db) {
    return;
  }

  await db.query(
    `
      insert into l402_receipts (
        payment_hash,
        skill_id,
        content_sha256,
        settled_at
      ) values ($1, $2, $3, now())
      on conflict (payment_hash) do update
      set
        skill_id = excluded.skill_id,
        content_sha256 = excluded.content_sha256,
        settled_at = coalesce(l402_receipts.settled_at, now())
    `,
    [input.paymentHash, input.skillId, input.contentSha256],
  );
}

export async function issueL402Challenge(input: ChallengeInput): Promise<L402Challenge> {
  const priceError = validateConfiguredPrice(input.priceSats);
  if (priceError) {
    throw new Error(priceError);
  }

  const { invoice, paymentHash } = await createInvoice(
    input.priceSats,
    input.skillId,
    input.contentSha256,
  );

  const macaroonB64 = mintMacaroon({
    paymentHash,
    skillId: input.skillId,
    contentSha256: input.contentSha256,
    path: input.path,
    method: input.method,
  });

  await recordChallenge({
    paymentHash,
    skillId: input.skillId,
    contentSha256: input.contentSha256,
    priceSats: input.priceSats,
    invoice,
  });

  return {
    invoice,
    macaroonB64,
    paymentHash,
    headers: [
      `LSAT macaroon="${macaroonB64}", invoice="${invoice}"`,
      `L402 macaroon="${macaroonB64}", invoice="${invoice}"`,
    ],
  };
}

export async function verifyL402Authorization(
  input: VerifyInput,
): Promise<L402Verification> {
  try {
    const { macaroonB64, preimageHex } = parseAuthorizationHeader(input.authorization);
    const paymentHash = verifyMacaroonCaveats(macaroonB64, input.expected);
    const derivedPaymentHash = paymentHashForPreimage(preimageHex);

    if (paymentHash !== derivedPaymentHash) {
      return { valid: false, reason: "payment preimage does not match payment hash" };
    }

    await recordReceipt({
      paymentHash,
      skillId: input.expected.skillId,
      contentSha256: input.expected.contentSha256,
    });

    return {
      valid: true,
      paymentHash,
      skillId: input.expected.skillId,
      contentSha256: input.expected.contentSha256,
    };
  } catch (error) {
    return {
      valid: false,
      reason:
        error instanceof Error ? error.message : "unable to verify authorization",
    };
  }
}
