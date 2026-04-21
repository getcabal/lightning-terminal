# Accessing Paywalled Skill Content with L402

This guide explains how to access paywalled skill content served by LiT's
L402-protected HTTP endpoints.

The flow is:

1. Fetch the public skill manifest.
2. Request the protected content and receive a `402 Payment Required`
   challenge.
3. Pay the returned Lightning invoice.
4. Retry the content request with an `Authorization: L402 ...` header.

This guide uses the current paywalled skill
`lightning-desktop-live-local-lnd`, but the same pattern applies to any future
skills exposed under the same endpoint family.

## Prerequisites

You need:

- a running `litd` instance that is reachable over HTTPS
- a connected and unlocked `lnd` behind LiT so the server can mint invoices
- a Lightning wallet or node that can pay BOLT11 invoices
- a way to retrieve the payment preimage after payment if you want to use the
  manual `curl` flow
- `curl`
- `jq`

For local development, LiT usually listens on `https://127.0.0.1:8443`. The
examples below use `curl -k` to ignore the self-signed TLS certificate. Do not
use `-k` in production unless you intentionally accept the TLS risk.

Set a few shell variables first:

```shell
BASE_URL='https://127.0.0.1:8443'
SKILL_ID='lightning-desktop-live-local-lnd'
```

## Step 1: Fetch the Public Manifest

The manifest is public. It tells you:

- the skill id
- the display metadata
- the current immutable content hash
- the purchase model
- the price in sats
- the versioned paid content URL

Fetch it:

```shell
curl -sk "$BASE_URL/.well-known/l402/skills/$SKILL_ID" | jq
```

Example shape:

```json
{
  "skill_id": "lightning-desktop-live-local-lnd",
  "title": "Live Local lnd For lightning-desktop",
  "summary": "...",
  "purchase_model": "one_purchase_per_immutable_version",
  "price_sats": 21,
  "content_sha256": "<sha256>",
  "manifest_url": "/.well-known/l402/skills/lightning-desktop-live-local-lnd",
  "paid_url": "/.well-known/l402/skills/lightning-desktop-live-local-lnd/v/<sha256>/content",
  "content_type": "text/markdown; charset=utf-8"
}
```

Store the dynamic fields instead of hard-coding them:

```shell
MANIFEST=$(curl -sk "$BASE_URL/.well-known/l402/skills/$SKILL_ID")
PAID_URL=$(echo "$MANIFEST" | jq -r '.paid_url')
CONTENT_HASH=$(echo "$MANIFEST" | jq -r '.content_sha256')
PRICE_SATS=$(echo "$MANIFEST" | jq -r '.price_sats')
```

## Step 2: Request the Protected Content

Now request the paid content without any authorization header:

```shell
HDRS=$(mktemp)
BODY=$(mktemp)

curl -sk -D "$HDRS" -o "$BODY" "$BASE_URL$PAID_URL"

cat "$BODY"
grep -i '^www-authenticate:' "$HDRS"
```

Expected result:

- status code `402 Payment Required`
- a JSON body describing the payment requirement
- one `WWW-Authenticate: LSAT ...` header
- one `WWW-Authenticate: L402 ...` header

The response body should not contain the protected markdown.

You can also verify that ordinary UI credentials do not bypass payment:

```shell
curl -ski -u test:test "$BASE_URL$PAID_URL"
```

This should still return `402 Payment Required`.

## Step 3: Extract the Invoice and Macaroon From the Challenge

Use the `L402` challenge line from the response headers:

```shell
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

The `macaroon` in the challenge is not enough by itself. To unlock the
document, you also need the payment preimage from the successful Lightning
payment.

## Step 4: Pay the Invoice

Pay the BOLT11 invoice with a Lightning wallet or node.

If you are using `lncli`, the simplest manual path is:

```shell
PAYMENT_JSON=$(lncli payinvoice --force --json "$INVOICE")
echo "$PAYMENT_JSON" | jq
PREIMAGE=$(echo "$PAYMENT_JSON" | jq -r '.payment_preimage')
```

If you use a different wallet, make sure it gives you the payment preimage.
Without the preimage you cannot build the manual `Authorization: L402 ...`
header yourself.

## Step 5: Retry the Content Request With the L402 Header

Once the invoice is settled and you have the preimage, retry the request with
the L402 authorization header:

```shell
curl -sk -D - \
  -H "Authorization: L402 ${MACAROON_B64}:${PREIMAGE}" \
  "$BASE_URL$PAID_URL"
```

Expected result:

- status code `200 OK`
- `Content-Type: text/markdown; charset=utf-8`
- `ETag: "<content_sha256>"`
- `X-Skill-Version: <content_sha256>`
- the markdown body

You can verify the version returned by the server matches the manifest:

```shell
curl -sk -D - \
  -H "Authorization: L402 ${MACAROON_B64}:${PREIMAGE}" \
  "$BASE_URL$PAID_URL" -o /dev/null |
  grep -Ei 'etag:|x-skill-version:'

echo "$CONTENT_HASH"
```

## Purchase Model Semantics

The current purchase model is:

`one_purchase_per_immutable_version`

That means:

- the right to access is bound to the specific content hash in the manifest
- if the skill content changes, the `content_sha256` changes
- a new content hash means a new versioned `paid_url`
- a new immutable version requires a new purchase

Clients should always start from the manifest instead of caching a `paid_url`
forever.

## One-Command Manual Flow

The following shell snippet performs the full manual flow except for the actual
payment step:

```shell
BASE_URL='https://127.0.0.1:8443'
SKILL_ID='lightning-desktop-live-local-lnd'

MANIFEST=$(curl -sk "$BASE_URL/.well-known/l402/skills/$SKILL_ID")
PAID_URL=$(echo "$MANIFEST" | jq -r '.paid_url')
HDRS=$(mktemp)

curl -sk -D "$HDRS" -o /dev/null "$BASE_URL$PAID_URL"

MACAROON_B64=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*macaroon="([^"]+)".*/\1/I'
)
INVOICE=$(
  grep -i '^www-authenticate: L402 ' "$HDRS" |
    sed -E 's/.*invoice="([^"]+)".*/\1/I'
)

echo "Pay this invoice:"
echo "$INVOICE"
echo
echo "After payment, retry with:"
echo "curl -sk -H \"Authorization: L402 ${MACAROON_B64}:<payment_preimage_hex>\" \"$BASE_URL$PAID_URL\""
```

## Troubleshooting

### `503 {"error":"skill paywall unavailable"}`

LiT could not create or verify the payment challenge. Typical causes:

- `litd` is not connected to `lnd`
- `lnd` is still locked
- the backend Lightning connection is unhealthy

### Repeated `402 Payment Required` after paying

Common causes:

- the invoice was not actually settled
- the preimage does not match the invoice you paid
- the request used the wrong `macaroon` or the wrong versioned `paid_url`
- the client sent an incorrectly formatted authorization header

The expected header format is:

```text
Authorization: L402 <base64_macaroon>:<64_char_hex_preimage>
```

### `404 {"error":"unknown skill version"}`

You are likely requesting an old or malformed versioned path. Fetch the
manifest again and use the current `paid_url`.

### `405 method not allowed`

The paywall routes support:

- `GET`
- `HEAD`
- `OPTIONS`

### Can I use LiT UI basic auth or a regular macaroon instead?

No. This endpoint is intentionally separate from LiT's normal authenticated UI
and RPC access. The paywalled skill content requires a valid L402.

## Client Integration Notes

If you are writing an automated client:

1. Fetch the manifest.
2. Request the `paid_url`.
3. Parse the `WWW-Authenticate` `L402` challenge.
4. Pay the invoice.
5. Retrieve the payment preimage.
6. Retry with the `Authorization: L402 ...` header.
7. Cache the paid authorization material only as long as it is appropriate for
   your client and threat model.

The server currently emits both `LSAT` and `L402` challenge variants for
backward compatibility. New clients should prefer the `L402` form.
