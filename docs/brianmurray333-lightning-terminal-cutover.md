# Deployment Notes For `brianmurray333s-projects/lightning-terminal`

This note is specific to the current Vercel setup for the existing web app and
the new paywall app.

## Existing App

Keep the existing project unchanged:

- dashboard: `https://vercel.com/brianmurray333s-projects/lightning-terminal`
- project id: `prj_5ctxpMBPxyNqHLbnXoQtSYq3N6Me`
- custom domain: `https://lightningnode.app`

Do not repoint this project at `paywall-web`.

## Paywall Project

The Vercel-native paywall now lives in a separate project:

- dashboard: `https://vercel.com/brianmurray333s-projects/lightning-terminal-paywall`
- project id: `prj_40bNKSxcNw9FXlqyBKeFa84N89Pp`
- local link: [paywall-web/.vercel/project.json](/Users/petermin/Codes/lightning-terminal/paywall-web/.vercel/project.json)
- public host: `https://l402.lightningnode.app`
- latest production deployment:
  `https://lightning-terminal-paywall-33u3wxug9-brianmurray333s-projects.vercel.app`
- latest production deployment id: `dpl_2t51om4zDTmVXaWqsTgFmmsfhawz`

The project is protected on deployment URLs by Vercel authentication, but
custom domains are public:

- protection mode: `all_except_custom_domains`

`paywall-web/vercel.json` now pins the framework to `nextjs`, which overrides
the incorrect `Other` preset in project settings and is required for the app
routes to resolve correctly on Vercel.

## Provisioned Resources

These resources are attached to `lightning-terminal-paywall`:

- Blob store: `lightning-terminal-paywall-blob`
- Blob store id: `store_49g8ou2ygkYmDFbq`
- Edge Config: `lightning-terminal-paywall-config`
- Edge Config id: `ecfg_t5ge6aju0pyk30tggusrvw3zioou`
- Neon database: `lightning-terminal-paywall-db`
- Neon resource id: `store_6Q9jQoxCZPepS3eN`

The Neon database schema from
[paywall-web/db/schema.sql](/Users/petermin/Codes/lightning-terminal/paywall-web/db/schema.sql)
has already been applied.

## Production Env State

Production is configured with:

- `DATABASE_URL` and related `POSTGRES_*` values from Neon
- `BLOB_READ_WRITE_TOKEN`
- direct Lightning envs for the Voltage-hosted `lnd` node:
  - `LIGHTNING_NODE_TYPE`
  - `LIGHTNING_NODE_URL`
  - `LIGHTNING_API_KEY`
  - `L402_MACAROON_ROOT_KEY`
  - `L402_INVOICE_EXPIRY`
  - `L402_MIN_AMOUNT_SATS`
  - `L402_MAX_AMOUNT_SATS`
  - `L402_SATS_PER_CREDIT`
  - `LIGHTNING_WEBHOOK_SECRET`
- `ADMIN_PUBLISH_TOKEN`

Production also has `EDGE_CONFIG`, `VERCEL_EDGE_CONFIG_ID`, and
`VERCEL_TEAM_ID`, but the current publish path does not depend on them because
the app falls back to Postgres when Edge Config is unset or empty.

Preview is not fully configured yet. Because Vercel preview envs are
branch-scoped in the CLI path we used, production was completed first. If you
want preview parity later, push the same Lightning/admin envs to a specific
preview branch and optionally add preview `EDGE_CONFIG`.

## Published Skill

The first skill version is live:

- skill id: `lightning-desktop-live-local-lnd`
- price: `21` sats
- content hash:
  `208cfb7e332ccf84701500c275d4014c5579b799a348e31581fc87859bba3fd8`
- manifest:
  `https://l402.lightningnode.app/.well-known/l402/skills/lightning-desktop-live-local-lnd`
- paid content:
  `https://l402.lightningnode.app/.well-known/l402/skills/lightning-desktop-live-local-lnd/v/208cfb7e332ccf84701500c275d4014c5579b799a348e31581fc87859bba3fd8/content`

The content source is:

- [skills/lightning-desktop-live-local-lnd/SKILL.md](/Users/petermin/Codes/lightning-terminal/skills/lightning-desktop-live-local-lnd/SKILL.md)

## Verified QA On April 21, 2026

These checks are complete:

- `GET /` on `https://l402.lightningnode.app` returns the paywall app homepage
- manifest lookup returns the published skill metadata
- unauthenticated content access returns `402 Payment Required`
- the challenge includes both `LSAT` and `L402` `WWW-Authenticate` headers
- authorized content access returns:
  - `200 OK`
  - `Content-Type: text/markdown; charset=utf-8`
  - `ETag` matching the published SHA-256
  - `X-Skill-Version` matching the published SHA-256

The authorized request was validated in operator mode by retrieving the invoice
preimage from the node's own `LookupInvoice` response. That verifies the L402
service path without spending funds, but it is not a substitute for a real
customer payment test.

## Real Customer-Payment QA

For a true end-user payment test:

1. Request the paid content URL and capture the `L402` challenge.
2. Pay the returned BOLT11 invoice from an external Lightning wallet or node.
3. Retry the request with:
   `Authorization: L402 <macaroon>:<payment_preimage_hex>`
4. Confirm the response is `200 OK` and returns the markdown body.

Helper scripts:

- [scripts/vercel_paywall_smoke.sh](/Users/petermin/Codes/lightning-terminal/scripts/vercel_paywall_smoke.sh)
- [scripts/vercel_paywall_env_push.sh](/Users/petermin/Codes/lightning-terminal/scripts/vercel_paywall_env_push.sh)

Reference docs:

- [docs/vercel-l402-paywall.md](/Users/petermin/Codes/lightning-terminal/docs/vercel-l402-paywall.md)
- [docs/l402-skill-access.md](/Users/petermin/Codes/lightning-terminal/docs/l402-skill-access.md)
