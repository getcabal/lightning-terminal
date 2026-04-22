---
name: lightning-desktop-live-local-lnd
description: Use when working in the lightning-desktop repo with a real local lnd node through the CLI's local-lnd backend. Covers discovering the local lnd and lncli setup, verifying network and RPC target, starting or connecting to a local node, creating an isolated CLI profile, and demonstrating useful live commands such as bootstrap status, wallet balance, address generation, node overview, peers, channels, and health without disturbing the user's normal CLI state.
---

# Live Local `lnd` For `lightning-desktop`

Use this skill when the user wants the repo's CLI to talk to a real local `lnd`
node.

## Scope

- Prefer user-provided node details. If none were provided, discover them from
  the current environment, the installed `lncli` and `lnd`, and the user's
  `lnd` config.
- Never print or persist wallet passwords, seed phrases, macaroons, or other
  secrets.

This skill is meant for live local-node QA and demos. It is strongest for:

- proving that the CLI is really talking to `lncli`
- creating an isolated profile without disturbing normal CLI state
- reading live startup, wallet, peer, channel, backup, and health state
- producing a real funding address
- planning safe next steps before any live mutation

Development-only simulated backends are out of scope for this skill and should
not be presented as an external operator feature.

## Runtime Configuration

These environment variables are the relevant knobs for this flow:

- `LIGHTNING_DESKTOP_DATA_DIR`: overrides the CLI application data directory
- `LIGHTNING_DESKTOP_KEYSTORE=file`: forces the file-backed developer keystore
  instead of the macOS keychain path
- `LIGHTNING_DESKTOP_NODE_BACKEND=local-lnd`: explicitly pins the live
  local-node backend when you want to be explicit in scripts or demos
- `LIGHTNING_DESKTOP_LNCLI_BIN`: points the backend at a specific `lncli`
  binary
- `LIGHTNING_DESKTOP_SECURE_INPUT_HELPER_BIN`: optional explicit path to the
  detached secure-input helper

Operational notes:

- The file-backed developer keystore and wrapped DB-key sidecar use lock files
  so parallel local runs do not corrupt state.
- Unix local-secret artifacts are written owner-only (`0600`).
- Human-entered high-sensitivity secrets are not accepted through normal CLI
  stdin. The CLI uses a detached secure-input helper when that flow is needed.
- Frontend and broker layers are not trusted with raw high-sensitivity secret
  material.

## Runtime Facts To Verify Each Time

Do not assume these are still true without checking:

- where `lnd` and `lncli` are installed
- which network is active
- which gRPC endpoint `lncli` should use
- whether the wallet is already unlocked
- the CLI should use `LIGHTNING_DESKTOP_NODE_BACKEND=local-lnd`

## Verification And Bring-Up

Run these checks first:

```bash
printenv | rg '^LIGHTNING_DESKTOP_|^LND' || true
command -v lncli || true
command -v lnd || true
pgrep -fl '(^|/)(lnd)$'
```

Then resolve the actual `lncli` binary and inspect the user's config if needed.
Common config locations include:

- macOS: `~/Library/Application Support/Lnd/lnd.conf`
- Linux: `~/.lnd/lnd.conf`

Resolve these shell variables before continuing:

```bash
export LNCLI_BIN="${LNCLI_BIN:-$(command -v lncli)}"
export LND_BIN="${LND_BIN:-$(command -v lnd)}"
```

Resolve `NETWORK` and `RPCSERVER` from user input, environment, or the `lnd`
config. A typical disposable local setup is:

```bash
export NETWORK="${NETWORK:-testnet}"
export RPCSERVER="${RPCSERVER:-127.0.0.1:10009}"
```

Once the network and RPC target are known, verify the node with:

```bash
"$LNCLI_BIN" --network="$NETWORK" --rpcserver="$RPCSERVER" state
```

Interpretation:

- `connection refused`: `lnd` is not running yet
- missing macaroon under the wrong network directory: `lncli` is using the
  wrong `--network`
- `LOCKED`: the wallet exists but must be unlocked
- `SERVER_ACTIVE`: the node is ready for live CLI use

If `lnd` is not running, start it directly:

```bash
"$LND_BIN"
```

If the wallet is locked, only use secrets the user explicitly supplied or a
trusted secret source already available in the environment. Do not mine repo
docs, shell history, or logs for credentials. If no approved secret source is
available, ask the user to unlock the wallet themselves.

If the user has approved a non-interactive unlock flow, use `--stdin` and do
not echo the password:

```bash
printf '%s\n' "$PASS" | "$LNCLI_BIN" --network="$NETWORK" unlock --stdin
```

Wait until:

```bash
"$LNCLI_BIN" --network="$NETWORK" --rpcserver="$RPCSERVER" state
```

returns `SERVER_ACTIVE`.

## CLI Environment

Use an isolated app state dir unless the user explicitly wants to reuse their
normal CLI state:

```bash
export LIGHTNING_DESKTOP_DATA_DIR="$(mktemp -d /tmp/lightning-desktop-live-demo.XXXXXX)"
export LIGHTNING_DESKTOP_KEYSTORE=file
export LIGHTNING_DESKTOP_NODE_BACKEND=local-lnd
export LIGHTNING_DESKTOP_LNCLI_BIN="$LNCLI_BIN"
```

Typical disposable local-node QA shell:

```bash
export LIGHTNING_DESKTOP_DATA_DIR="${LIGHTNING_DESKTOP_DATA_DIR:-/tmp/lightning-desktop}"
export LIGHTNING_DESKTOP_KEYSTORE=file
export LIGHTNING_DESKTOP_NODE_BACKEND=local-lnd
export LIGHTNING_DESKTOP_LNCLI_BIN="$LNCLI_BIN"
```

Create a live profile pointed at the verified local node:

```bash
cargo run -p cli -- --output json profile create \
  --name <profile-name> \
  --network <network> \
  --endpoint <rpcserver> \
  --trust-mode <trust-mode>
```

For disposable development nodes, `tofu-dev-only` is the usual choice. For
non-disposable or higher-trust environments, use the trust mode that matches
the actual certificate and deployment model.

Minimal live demo sequence:

```bash
cargo run -p cli -- --output json profile create \
  --name local-lnd-demo \
  --network "$NETWORK" \
  --endpoint "$RPCSERVER" \
  --trust-mode tofu-dev-only

cargo run -p cli -- --output json --profile local-lnd-demo bootstrap status
cargo run -p cli -- --output json --profile local-lnd-demo node overview
cargo run -p cli -- --output json --profile local-lnd-demo wallet balance
```

## Useful Live Commands

Use these first because they prove the live backend is working and produce
useful output without risky mutations:

```bash
cargo run -p cli -- --output json --profile <profile-name> bootstrap status
cargo run -p cli -- --output json --profile <profile-name> wallet balance
cargo run -p cli -- --output json --profile <profile-name> wallet address new
cargo run -p cli -- --output json --profile <profile-name> node overview
cargo run -p cli -- --output json --profile <profile-name> peers list
cargo run -p cli -- --output json --profile <profile-name> channels list
cargo run -p cli -- --output json --profile <profile-name> health status
```

Useful things to call out in the results:

- lifecycle state and blocking reasons from `bootstrap status`
- spendable vs pending on-chain balance from `wallet balance`
- a real funding address from `wallet address new`
- live peer, channel, backup, and health state from `node overview`

## Backend Behavior

This backend is intentionally thin:

- it shells out to `lncli` instead of speaking gRPC directly
- `bootstrap status` and `node overview` refresh startup, wallet, peers,
  channels, backup, and health state from the live node before lifecycle gating
- `wallet balance` reflects `lnd` semantics, including anchor reserves reducing
  spendable balance
- `wallet address new` generates a real address from the live node
- risky operations still flow through the app's lifecycle and policy checks

## Behavior Notes

- The `local-lnd` backend refreshes startup, wallet, peers, channels, backup,
  and health state from `lncli`.
- A newly created profile may begin in a seeded fake `WaitingInit` state. The
  first live command refreshes it to the real `lnd` lifecycle state.
- CLI spendable balance can be lower than total wallet balance because `lnd`
  reserves anchor balance.

## Safe Default Scope

Default to read-only or minimally invasive commands.

- Safe: `bootstrap status`, `wallet balance`, `wallet address new`,
  `node overview`, `peers list`, `channels list`, `health status`
- Use care: `peers connect`, `channels open plan`
- Require explicit user confirmation of intent: `channels open apply` or any
  command that would create a real peer or channel mutation

Prefer `regtest`, `signet`, or `testnet` unless the user explicitly asks for
mainnet work and the risk is justified.

## Relevant Code Paths

Read these files if you need to explain or debug the integration:

- `crates/cli/src/runtime.rs`
- `crates/adapter-lnd/src/lib.rs`
- `crates/adapter-lnd-bootstrap/src/lib.rs`
