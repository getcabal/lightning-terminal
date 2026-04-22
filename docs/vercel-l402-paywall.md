# Vercel Lightning L402 Paywall

This repo now carries a Vercel-native Lightning `L402` paywall in
[`paywall-web`](/Users/petermin/Codes/lightning-terminal/paywall-web/README.md).

## Architecture

`paywall-web` is a Next.js app that:

- serves a public manifest at `/.well-known/l402/skills/:skillId`
- serves a paywalled content route at
  `/.well-known/l402/skills/:skillId/v/:sha/content`
- mints Lightning invoices directly against an `lnd` node over REST
- issues and verifies first-party L402 macaroons in-app
- stores immutable markdown in private `Vercel Blob`
- stores published versions in `Postgres`
- optionally mirrors the active manifest record into `Edge Config`

There is no separate gateway service in this design.

## Required Services

Provision these for the Vercel project that hosts `paywall-web`:

- a private Blob store
- a Postgres database
- an Edge Config instance if you want low-latency manifest reads
- network access from Vercel Functions to your Lightning node

Before first use, apply
[`paywall-web/db/schema.sql`](/Users/petermin/Codes/lightning-terminal/paywall-web/db/schema.sql)
to the database.

## Environment

See
[`paywall-web/.env.example`](/Users/petermin/Codes/lightning-terminal/paywall-web/.env.example)
for the local shape and these templates for Vercel pushes:

- [paywall-web/env.production.push.example](/Users/petermin/Codes/lightning-terminal/paywall-web/env.production.push.example)
- [paywall-web/env.preview.push.example](/Users/petermin/Codes/lightning-terminal/paywall-web/env.preview.push.example)

Required:

- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `LIGHTNING_NODE_TYPE=lnd`
- `LIGHTNING_NODE_URL`
- `LIGHTNING_API_KEY`
- `L402_MACAROON_ROOT_KEY`
- `ADMIN_PUBLISH_TOKEN`

Optional:

- `EDGE_CONFIG`
- `VERCEL_ACCESS_TOKEN`
- `VERCEL_EDGE_CONFIG_ID`
- `VERCEL_TEAM_ID`
- `L402_INVOICE_EXPIRY`
- `L402_MIN_AMOUNT_SATS`
- `L402_MAX_AMOUNT_SATS`

## Deploy Order

1. Link or create a Vercel project for `paywall-web`.
2. Provision Blob, Postgres, and optionally Edge Config for that project.
3. Configure the Lightning and admin env vars.
4. Deploy `paywall-web` to Vercel.
5. Publish at least one skill version.
6. Run the L402 challenge and paid-content QA flow.

## Publish Flow

Publish a skill version by sending the markdown payload to the admin endpoint:

```bash
curl -X POST "https://<your-paywall-host>/api/admin/publish-skill" \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "lightning-desktop-live-local-lnd",
    "title": "Live Local lnd For lightning-desktop",
    "summary": "Use when working in the lightning-desktop repo with a real local lnd node through the CLI local-lnd backend.",
    "priceSats": 21,
    "content": "# Paid Skill\n\nSecret markdown content."
  }'
```

The handler will:

- compute the content SHA-256
- upload the content to private Blob
- upsert the version in Postgres
- mark it active
- mirror the active record into Edge Config when `VERCEL_ACCESS_TOKEN` and
  `VERCEL_EDGE_CONFIG_ID` are configured

## QA Flow

Set the base URL and skill id:

```bash
BASE_URL='https://<your-paywall-host>'
SKILL_ID='lightning-desktop-live-local-lnd'
```

Fetch the public manifest:

```bash
MANIFEST=$(curl -sS "$BASE_URL/.well-known/l402/skills/$SKILL_ID")
echo "$MANIFEST" | jq

PAID_URL=$(echo "$MANIFEST" | jq -r '.paid_url')
CONTENT_HASH=$(echo "$MANIFEST" | jq -r '.content_sha256')
```

Request the protected content without authorization:

```bash
HDRS=$(mktemp)
BODY=$(mktemp)

curl -sS -D "$HDRS" -o "$BODY" "$BASE_URL$PAID_URL"
cat "$BODY"
grep -i '^www-authenticate:' "$HDRS"
```

Expected:

- `402 Payment Required`
- one `WWW-Authenticate: LSAT ...` header
- one `WWW-Authenticate: L402 ...` header
- no markdown body

Extract the challenge fields:

```bash
MACAROON_B64=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*macaroon="([^"]+)".*/\1/I'
)
INVOICE=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*invoice="([^"]+)".*/\1/I'
)
```

Pay the invoice with a Lightning wallet or node, retrieve the payment
preimage, then retry:

```bash
curl -sS -D - \
  -H "Authorization: L402 ${MACAROON_B64}:<payment_preimage_hex>" \
  "$BASE_URL$PAID_URL"
```

Expected:

- `200 OK`
- `Content-Type: text/markdown; charset=utf-8`
- `ETag: "<content_sha256>"`
- `X-Skill-Version: <content_sha256>`
- the markdown body

## Operational Notes

- No webhook is required for the basic flow. The payment preimage is the proof
  of payment.
- If you want the publish route to update Edge Config immediately, provide
  `VERCEL_ACCESS_TOKEN`, `VERCEL_EDGE_CONFIG_ID`, and `VERCEL_TEAM_ID`.
- If Edge Config is unavailable or missing the active record, the app falls
  back to Postgres.
