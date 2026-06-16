---
name: wallet-cli
description: >
  Plan-driven CLI for burner-wallet operations across EVM chains and Solana —
  send native/ERC-20 tokens, approve spenders, call contracts, send raw
  transactions, batch-scan balances, and split funds across many wallets. A
  transaction is data (a JSON plan), not hand-written code. Use this skill
  WHENEVER the user wants to move crypto, sweep or consolidate wallets,
  distribute/airdrop tokens to many addresses, approve a spender, call a
  contract method, check balances across wallets, or work with the wallet-cli
  tool in any way — even if they don't name the tool explicitly. Also use it
  before any git push in a repo containing this tool (run the credential audit).
---

# wallet-cli

A plan-driven CLI for day-to-day burner-wallet operations on EVM chains and
Solana. Every action funnels through ONE path:

```
plan JSON → validate → simulate → sign → broadcast → log
```

**Core principle: a transaction is data, not code.** You never hand-write
transaction logic and you never compute token amounts in your head — you
generate or write a JSON plan and let the CLI execute it deterministically.

## Install (once per machine)

```bash
git clone https://github.com/oxkage/wallet-cli.git
cd wallet-cli
npm install
npm run build
node dist/index.js --help        # verify
```

Requires Node.js >= 18 (developed on Node 22) and `git`. No global install
needed — invoke via `node dist/index.js <command>`, or `npm link` for a global
`wallet-cli` binary.

## Configure

```bash
cp .env.example .env
```

Fill two values; the rest are optional:

- `SEED_PHRASE` — BIP-39 mnemonic; all EVM wallets derive from it.
- `ALCHEMY_API_KEY` — one key builds the RPC URL for every supported chain.
  Without it, the tool falls back to bundled public RPCs (slower, rate-limited).

`.env` is gitignored. Never commit it. Run `node dist/index.js audit` before any push.

## Workflow (always follow this order)

1. **Discover** — `ops list` shows the available op types; `ops describe <type>`
   prints a live, copy-pasteable example plan.
2. **Scan** — for sweep/distribute, `scan` reads real on-chain balances first.
   Never guess balances.
3. **Compose** — write a plan JSON or generate one with `scaffold`. Never
   compute split amounts yourself — `scaffold distribute` does sum-preserving
   BigInt math.
4. **Validate** — `validate <plan>` checks schema + `.env` offline (no RPC, no
   broadcast). Fix every error before proceeding.
5. **Dry-run** — `run <plan>` simulates and signs but does NOT broadcast by
   default. Inspect the output.
6. **Broadcast** — re-run with `run <plan> --yes` only when you intend to send.
7. **Log** — every broadcast is recorded; query it with `history`.

## Command cheatsheet

| Command | Purpose |
| --- | --- |
| `run [plan]` | Execute a plan. Dry-run unless `--yes`. |
| `validate [plan]` | Schema + `.env` check, offline. Run first. |
| `scan` | Batch-read native + token balances over a wallet index range. |
| `scaffold sweep\|multisend\|collect\|distribute\|csv` | Generate plan JSON (never broadcasts). |
| `ops list` / `ops describe <type>` | Discover the 5 op types live. |
| `balance` / `history` | Inspect balances / the on-chain action log. |
| `chains list` / `chains test-rpc` | Chain registry + RPC health. |
| `collect-tokens` | Manage the per-chain ERC-20 token registry. |
| `export` | Export public wallet fields only (safe to share). |
| `audit` | Pre-push credential scan. Run before every push. |

The five op types: `native-send`, `erc20-transfer`, `erc20-approve`,
`contract-call`, `raw-tx`.

## Critical rules

1. **Never compute distribute/split amounts yourself.** Use
   `scaffold distribute --split equal|jitter|fixed --amount all`; the CLI does
   the sum-preserving BigInt math.
2. **`scan` before you sweep or distribute** — operate on real balances.
3. **`run` without `--yes` is a dry-run.** Inspect, then add `--yes` to broadcast.
4. **`validate` is offline and cheap.** Run it first to catch errors before
   touching the network.
5. **Run `audit` before pushing** any change to a repo containing this tool.

## Don't memorize flags — ask the tool

```bash
node dist/index.js <command> --help
node dist/index.js ops describe erc20-transfer
node dist/index.js scaffold distribute --help
```

## Going deeper

This SKILL.md is the fast path. For more detail, read these from the repo as needed:

- **`docs/INSTALL.md`** — expanded install + bootstrap walkthrough.
- **`README.md`** — full command reference, recipes, value formats, troubleshooting.
- **`AGENTS.md`** — architecture, internals, and how to add a new op or chain.
- **`docs/architecture.png`** — system diagram (inputs → plan → runtime → chains).
