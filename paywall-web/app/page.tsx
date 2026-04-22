import styles from "./page.module.css";

const installCommand =
  '/bin/bash -c "$(curl -fsSL https://l402.lightningnode.app/install-l402-walkthrough.sh)"';

const cliCommand = "l402-walkthrough";

const benefits = [
  {
    title: "Sell paid Markdown instantly",
    body:
      "Publish immutable skill or documentation versions behind a Lightning invoice instead of building a separate auth system.",
  },
  {
    title: "Test the real L402 flow",
    body:
      "The live host returns real 402 challenges, BOLT11 invoices, and paid-content responses so you can validate the full client flow.",
  },
  {
    title: "Stay terminal-first",
    body:
      "The walkthrough CLI handles the sequence, explains how to obtain the required inputs, and gets you through the live flow without any admin credential.",
  },
];

const steps = [
  {
    title: "Install the walkthrough CLI",
    detail:
      "This downloads the current l402 walkthrough script and installs it into ~/.local/bin as l402-walkthrough.",
    code: installCommand,
  },
  {
    title: "Run the CLI",
    detail:
      "The CLI walks you through the service step by step and explains how to acquire the information it asks for.",
    code: cliCommand,
  },
  {
    title: "Choose a workflow",
    detail:
      "Use “Access a live paid skill” to test the published 21-sat skill, or “Inspect the live service” for a read-only sanity check before paying.",
  },
  {
    title: "Complete the payment flow",
    detail:
      "Pay the BOLT11 invoice with lncli or another Lightning wallet that exposes the preimage, then paste that 64-character preimage when the CLI asks for it.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Lightning L402 On Vercel</p>
        <h1>Publish, sell, and test paid Markdown over Lightning.</h1>
        <p className={styles.summary}>
          <strong>Why:</strong> use L402 to gate documentation, skills, or other
          immutable markdown behind real Lightning invoices without building a
          separate login system.
        </p>
        <p className={styles.summary}>
          <strong>How:</strong> install the guided CLI, run it, pick the workflow
          you want, and follow the prompts. The live host already has a
          published test skill at <code>21 sats</code>, and you do not need an
          admin token to use it.
        </p>
        <div className={styles.heroActions}>
          <a className={styles.primaryAction} href="/install-l402-walkthrough.sh">
            Download installer
          </a>
          <a
            className={styles.secondaryAction}
            href="/.well-known/l402/skills/lightning-desktop-live-local-lnd"
          >
            Open live manifest
          </a>
        </div>
      </section>

      <section className={styles.grid}>
        {benefits.map((benefit) => (
          <article className={styles.card} key={benefit.title}>
            <h2>{benefit.title}</h2>
            <p className={styles.cardText}>{benefit.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.card}>
        <h2>Get Started</h2>
        <ol className={styles.stepList}>
          {steps.map((step, index) => (
            <li className={styles.stepItem} key={step.title}>
              <div className={styles.stepNumber}>{index + 1}</div>
              <div className={styles.stepBody}>
                <h3>{step.title}</h3>
                <p className={styles.cardText}>{step.detail}</p>
                {step.code ? <pre className={styles.snippet}>{step.code}</pre> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.card}>
        <h2>Current Live Skill</h2>
        <ul className={styles.codeList}>
          <li>
            <code>skill_id = lightning-desktop-live-local-lnd</code>
          </li>
          <li>
            <code>price_sats = 21</code>
          </li>
          <li>
            <code>host = https://l402.lightningnode.app</code>
          </li>
        </ul>
      </section>

      <section className={styles.card}>
        <h2>Manual users</h2>
        <p className={styles.cardText}>
          If you prefer raw HTTP instead of the CLI, start with the manifest,
          request the paid URL, pay the invoice, then retry with an
          <code> Authorization: L402 ...</code> header.
        </p>
        <pre className={styles.snippet}>
{`curl -sS https://l402.lightningnode.app/.well-known/l402/skills/lightning-desktop-live-local-lnd | jq

curl -i https://l402.lightningnode.app/.well-known/l402/skills/lightning-desktop-live-local-lnd/v/<sha>/content

curl -i \
  -H "Authorization: L402 <base64_macaroon>:<preimage_hex>" \
  https://l402.lightningnode.app/.well-known/l402/skills/lightning-desktop-live-local-lnd/v/<sha>/content`}
        </pre>
      </section>
    </main>
  );
}
