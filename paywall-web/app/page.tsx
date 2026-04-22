import styles from "./page.module.css";

const endpoints = [
  "GET /.well-known/l402/skills/:skillId",
  "GET /.well-known/l402/skills/:skillId/v/:sha/content",
  "POST /api/admin/publish-skill",
];

const requiredEnv = [
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "LIGHTNING_NODE_TYPE",
  "LIGHTNING_NODE_URL",
  "LIGHTNING_API_KEY",
  "L402_MACAROON_ROOT_KEY",
  "ADMIN_PUBLISH_TOKEN",
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Lightning L402 On Vercel</p>
        <h1>Manifest, paywall, publish, and blob delivery in one app.</h1>
        <p className={styles.summary}>
          This project exposes L402 skill manifests and paid content routes
          directly from a Next.js app running on Vercel. Immutable markdown
          versions live in Private Blob, current manifests can be mirrored into
          Edge Config, publish metadata is stored in Postgres, and invoices are
          minted against an LND node over its REST API.
        </p>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Routes</h2>
          <ul className={styles.codeList}>
            {endpoints.map((endpoint) => (
              <li key={endpoint}>
                <code>{endpoint}</code>
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <h2>Required Env</h2>
          <ul className={styles.codeList}>
            {requiredEnv.map((envName) => (
              <li key={envName}>
                <code>{envName}</code>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className={styles.card}>
        <h2>Manual Smoke Test</h2>
        <pre className={styles.snippet}>
{`curl -sS https://<host>/.well-known/l402/skills/<skill-id> | jq

curl -i https://<host>/.well-known/l402/skills/<skill-id>/v/<sha>/content

curl -i \
  -H "Authorization: L402 <base64_macaroon>:<preimage_hex>" \
  https://<host>/.well-known/l402/skills/<skill-id>/v/<sha>/content`}
        </pre>
      </section>
    </main>
  );
}
