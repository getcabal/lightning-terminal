# Paywall Web

`paywall-web` is a Next.js app that serves Lightning `L402` skill manifests,
protected content routes, and an authenticated publish endpoint for immutable
markdown skill versions.

## What It Does

- serves the public manifest at `/.well-known/l402/skills/:skillId`
- challenges protected content requests at
  `/.well-known/l402/skills/:skillId/v/:sha/content`
- mints invoices directly against an `lnd` node over REST
- verifies `Authorization: L402 ...` headers locally with first-party macaroons
- stores immutable content in `Vercel Blob` private storage
- stores active/current manifest metadata in `Edge Config`
- stores published versions in `Postgres`

## Environment

Copy `.env.example` to `.env.local` and fill in the required values.
For Vercel env pushes, copy one of:

- `env.preview.push.example`
- `env.production.push.example`

Required at runtime:

- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `LIGHTNING_NODE_TYPE`
- `LIGHTNING_NODE_URL`
- `LIGHTNING_API_KEY`
- `L402_MACAROON_ROOT_KEY`
- `ADMIN_PUBLISH_TOKEN`

Optional but recommended:

- `EDGE_CONFIG`
- `VERCEL_ACCESS_TOKEN`
- `VERCEL_EDGE_CONFIG_ID`
- `VERCEL_TEAM_ID`
- `L402_INVOICE_EXPIRY`
- `L402_MIN_AMOUNT_SATS`
- `L402_MAX_AMOUNT_SATS`

## Local Development

```bash
yarn install
yarn dev
```

The admin publish route expects:

```bash
curl -X POST http://localhost:3000/api/admin/publish-skill \
  -H "Authorization: Bearer $ADMIN_PUBLISH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "lightning-desktop-live-local-lnd",
    "title": "Live Local lnd For lightning-desktop",
    "summary": "Use when working in the lightning-desktop repo...",
    "priceSats": 21,
    "content": "# Paid Skill\n\nSecret markdown content."
  }'
```

## Vercel Setup

1. `cd paywall-web`
2. `vercel link`
3. provision:
   - a private Blob store
   - an Edge Config instance
   - a Marketplace Postgres database
4. configure the environment variables in Vercel
5. deploy with `vercel deploy`
6. publish a skill with the admin route

This app does not require a separate L402 gateway service.
