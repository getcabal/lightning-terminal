# `l402.lightningnode.app` End-To-End Walkthrough

This guide explains how to start using the live features at:

- `https://l402.lightningnode.app`

As of April 21, 2026 Pacific Time, this host is an API-style Lightning `L402`
paywall service, not a full browser UI.

## Interactive CLI

If you want a guided terminal flow instead of following the commands manually,
install the CLI with:

```bash
/bin/bash -c "$(curl -fsSL https://l402.lightningnode.app/install-l402-walkthrough.sh)"
```

Then run:

```bash
l402-walkthrough
```

The CLI can:

- walk you through accessing the live paid skill
- inspect the live service and current manifest
- save the exact invoice, macaroon, and paid URL for a challenge and resume it
  later
- optionally publish a new skill version if you are the operator and already
  have the admin token

The public access flow does not require any admin credential.

## What Is Live

Current live routes:

- `GET /` returns a simple info page
- `GET /.well-known/l402/skills/:skillId` returns a public manifest
- `GET /.well-known/l402/skills/:skillId/v/:sha/content` returns either a
  `402 Payment Required` challenge or the paid markdown
- `POST /api/admin/publish-skill` publishes a new paid skill version

Current published skill:

- `skill_id`: `lightning-desktop-live-local-lnd`
- `price_sats`: `21`
- `content_sha256`:
  `208cfb7e332ccf84701500c275d4014c5579b799a348e31581fc87859bba3fd8`

## Prerequisites

You need:

- `curl`
- `jq`
- a Lightning wallet or node that can pay BOLT11 invoices
- a way to retrieve the payment preimage after payment if you want to do the
  full manual `curl` flow

Set these shell variables first:

```bash
BASE_URL='https://l402.lightningnode.app'
SKILL_ID='lightning-desktop-live-local-lnd'
```

## Quick Smoke Test

The fastest first check from this repo is:

```bash
./scripts/vercel_paywall_smoke.sh \
  https://l402.lightningnode.app \
  lightning-desktop-live-local-lnd
```

That script will:

- fetch the public manifest
- request the protected content
- print the `402 Payment Required` challenge

## Step 1: Fetch The Public Manifest

The manifest is public. It tells you:

- the skill id
- title and summary
- current immutable content hash
- purchase model
- price in sats
- versioned paid content URL

Fetch it:

```bash
MANIFEST=$(curl -sS "$BASE_URL/.well-known/l402/skills/$SKILL_ID")
echo "$MANIFEST" | jq
```

At the time this guide was written, the live manifest shape is:

```json
{
  "skill_id": "lightning-desktop-live-local-lnd",
  "title": "Live Local `lnd` For `lightning-desktop`",
  "summary": "Use when working in the lightning-desktop repo with a real local lnd node through the CLI's local-lnd backend. Covers discovering the local lnd and lncli setup, verifying network and RPC target, starting or connecting to a local node, creating an isolated CLI profile, and demonstrating useful live commands such as bootstrap status, wallet balance, address generation, node overview, peers, channels, and health without disturbing the user's normal CLI state.",
  "purchase_model": "one_purchase_per_immutable_version",
  "price_sats": 21,
  "content_sha256": "208cfb7e332ccf84701500c275d4014c5579b799a348e31581fc87859bba3fd8",
  "manifest_url": "/.well-known/l402/skills/lightning-desktop-live-local-lnd",
  "paid_url": "/.well-known/l402/skills/lightning-desktop-live-local-lnd/v/208cfb7e332ccf84701500c275d4014c5579b799a348e31581fc87859bba3fd8/content",
  "content_type": "text/markdown; charset=utf-8"
}
```

Extract the dynamic fields:

```bash
PAID_URL=$(echo "$MANIFEST" | jq -r '.paid_url')
CONTENT_HASH=$(echo "$MANIFEST" | jq -r '.content_sha256')
PRICE_SATS=$(echo "$MANIFEST" | jq -r '.price_sats')
```

## Step 2: Request The Protected Content

Now request the paid content without any authorization header:

```bash
HDRS=$(mktemp)
BODY=$(mktemp)

curl -sS -D "$HDRS" -o "$BODY" "$BASE_URL$PAID_URL"

cat "$BODY"
grep -i '^www-authenticate:' "$HDRS"
```

Expected result:

- status code `402 Payment Required`
- JSON body with `error: payment_required`
- one `WWW-Authenticate: LSAT ...`
- one `WWW-Authenticate: L402 ...`

The response body should not contain the protected markdown.

## Step 3: Extract The Invoice And Macaroon

Use the `L402` challenge line from the response headers:

```bash
MACAROON_B64=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*macaroon="([^"]+)".*/\1/I'
)

INVOICE=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*invoice="([^"]+)".*/\1/I'
)

echo "$PRICE_SATS sats"
echo "$INVOICE"
```

The macaroon by itself does not unlock the document. You also need the payment
preimage from the successful Lightning payment.

## Step 4: Pay The Invoice

Pay the returned BOLT11 invoice with a Lightning wallet or node.

If you are using `lncli`, a manual path looks like:

```bash
PAYMENT_JSON=$(lncli payinvoice --force --json "$INVOICE")
echo "$PAYMENT_JSON" | jq
PREIMAGE=$(echo "$PAYMENT_JSON" | jq -r '.payment_preimage')
```

If you use a different wallet, make sure it gives you the payment preimage.
Without the preimage you cannot complete the manual `Authorization: L402 ...`
request yourself.

If you are not ready to finish the authorization step immediately, the CLI can
save the challenge details to a JSON file and later resume the exact same
invoice/macaroon pair. That prevents mixing a preimage from one challenge with a
macaroon from another.

## Step 5: Retry With The `L402` Authorization Header

Once the invoice is settled and you have the preimage, retry the request:

```bash
curl -sS -D - \
  -H "Authorization: L402 ${MACAROON_B64}:${PREIMAGE}" \
  "$BASE_URL$PAID_URL"
```

Expected result:

- status code `200 OK`
- `Content-Type: text/markdown; charset=utf-8`
- `ETag: "<content_sha256>"`
- `X-Skill-Version: <content_sha256>`
- markdown body returned

To verify only the headers:

```bash
curl -sS -D - \
  -H "Authorization: L402 ${MACAROON_B64}:${PREIMAGE}" \
  "$BASE_URL$PAID_URL" -o /dev/null |
  grep -Ei 'HTTP/|etag:|x-skill-version:|content-type:'

echo "$CONTENT_HASH"
```

## Purchase Model Semantics

The current purchase model is:

- `one_purchase_per_immutable_version`

That means:

- access is bound to the specific content hash in the manifest
- if the content changes, the `content_sha256` changes
- a new content hash means a new versioned `paid_url`
- a new immutable version requires a new purchase

Clients should always start from the manifest instead of caching a `paid_url`
indefinitely.

## Optional Operator Flow: Publish Your Own Skill Version

If you want to use the operator-side features, you need the
`ADMIN_PUBLISH_TOKEN` configured in Vercel for the paywall project.

Prepare a JSON payload:

```bash
cat > /tmp/publish.json <<'EOF'
{
  "skillId": "my-new-skill",
  "title": "My New Skill",
  "summary": "Short public description of the paid skill.",
  "priceSats": 21,
  "content": "# My New Skill\n\nThis is the paid markdown body."
}
EOF
```

Publish it:

```bash
curl -X POST "https://l402.lightningnode.app/api/admin/publish-skill" \
  -H "Authorization: Bearer <ADMIN_PUBLISH_TOKEN>" \
  -H "Content-Type: application/json" \
  --data @/tmp/publish.json
```

Expected result:

- HTTP `200`
- manifest JSON for the new skill
- computed `content_sha256`
- canonical `paid_url`

Fetch the new manifest:

```bash
curl -sS "https://l402.lightningnode.app/.well-known/l402/skills/my-new-skill" | jq
```

Then run the same access flow:

```bash
./scripts/vercel_paywall_smoke.sh \
  https://l402.lightningnode.app \
  my-new-skill
```

## Common Constraints

For publishing:

- `priceSats` must be a positive integer
- current configured range is `1` to `100000` sats

For paid access:

- the preimage must match the exact invoice you paid
- the macaroon must be the one returned with that challenge
- the `paid_url` must match the current immutable version

## Troubleshooting

### `402 Payment Required` after you already paid

Common causes:

- wrong preimage
- wrong macaroon
- wrong `paid_url`
- malformed authorization header

Expected format:

```text
Authorization: L402 <base64_macaroon>:<64_char_hex_preimage>
```

### `404 {"error":"unknown skill version"}`

Fetch the manifest again and use the current `paid_url`.

### `503 {"error":"unable to mint payment challenge"}`

The service could not create an invoice against the Lightning node. Typical
causes:

- the configured `lnd` REST endpoint is unreachable from Vercel
- the configured Lightning macaroon is invalid
- the node is unhealthy

### `401 unauthorized` on publish

The `Authorization: Bearer ...` token for `POST /api/admin/publish-skill` is
wrong.

## Related Docs And Scripts

- [docs/l402-skill-access.md](/Users/petermin/Codes/lightning-terminal/docs/l402-skill-access.md)
- [docs/vercel-l402-paywall.md](/Users/petermin/Codes/lightning-terminal/docs/vercel-l402-paywall.md)
- [scripts/vercel_paywall_smoke.sh](/Users/petermin/Codes/lightning-terminal/scripts/vercel_paywall_smoke.sh)
