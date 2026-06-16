---
name: wallet-cli
description: >
  Plan-driven CLI for burner-wallet operations across EVM chains and Solana —
  send native/ERC-20 tokens, approve spenders, call contracts, send raw
  transactions, batch-scan balances, and split/airdrop funds across many
  wallets. A transaction is data (a JSON plan), not hand-written code. Use this
  skill WHENEVER the user wants to move crypto, sweep or consolidate wallets,
  distribute or airdrop tokens to many addresses, approve a spender, call a
  contract method, or check balances across wallets — even if they don't name
  the tool explicitly. Also use it before any git push in a repo containing this
  tool (run the credential audit).
---

# Using wallet-cli

A plan-driven CLI for burner-wallet operations on EVM chains and Solana. Every
action funnels through ONE path:

```
plan JSON → validate → simulate → sign → broadcast → log
```

**Core principle: a transaction is data, not code.** Never hand-write
transaction logic and never compute token amounts in your head. Generate or
write a JSON plan; let the CLI execute it deterministically.

> Already installed? Just use it below. Not installed yet? See `docs/INSTALL.md`
> (one-time: clone, `npm install`, `npm run build`, fill `.env`).
> Invoke as `node dist/index.js <command>` (or `wallet-cli <command>` if linked).

## The workflow — always this order

1. **Discover** — `ops list` shows the op types; `ops describe <type>` prints a
   live, copy-pasteable example plan.
2. **Scan** — for sweep/distribute, `scan` reads real on-chain balances first.
   Never guess balances.
3. **Compose** — write a plan JSON, or generate one with `scaffold`. Never
   compute split amounts yourself — `scaffold distribute` does the
   sum-preserving BigInt math.
4. **Validate** — `validate <plan>` checks schema + `.env` offline (no RPC, no
   broadcast). Fix every error before continuing.
5. **Dry-run** — `run <plan>` simulates and signs but does NOT broadcast.
   Inspect the output.
6. **Broadcast** — `run <plan> --yes` only when you intend to send.
7. **Confirm** — every broadcast is logged; query it with `history`.

## The 5 op types

| Type | Does | Generate with |
| --- | --- | --- |
| `native-send` | Send the chain's native coin (ETH, etc.) | `scaffold sweep` / hand-write |
| `erc20-transfer` | Send an ERC-20 token | `scaffold multisend` / `distribute` |
| `erc20-approve` | Approve a spender allowance | hand-write (`ops describe erc20-approve`) |
| `contract-call` | Call an arbitrary contract method | hand-write (`ops describe contract-call`) |
| `raw-tx` | Broadcast pre-built calldata | hand-write |

Run `ops describe <type>` for a ready-to-edit example of any of these.

## Common tasks

**Sweep wallets in an index range to one destination**
```bash
node dist/index.js scaffold sweep --chain base --from-idx 0 --to-idx 5 \
  --to 0xDST --include native,USDC --out sweep.json
node dist/index.js validate sweep.json
node dist/index.js run sweep.json            # dry-run
node dist/index.js run sweep.json --yes      # broadcast
```

**Send a token to many recipients (multisend / airdrop)**
```bash
# inline recipients as address:amount pairs...
node dist/index.js scaffold multisend --chain base --from 0 \
  --recipients 0xAAA:10,0xBBB:25 --out ms.json
# ...or from a CSV (address,amount[,token][,chain] per row):
node dist/index.js scaffold csv recipients.csv --chain base --out ms.json
node dist/index.js validate ms.json && node dist/index.js run ms.json --yes
```

**Split a balance across an index range (let the CLI do the math)**
```bash
node dist/index.js scan --chain base --from 0 --to 20            # read balances first
node dist/index.js scaffold distribute --chain base --from 0 \
  --to-idx 1 --to-idx-end 20 --token native --amount all --split equal --out dist.json
node dist/index.js run dist.json --yes
```
`--split` accepts `equal`, `jitter` (randomized but sum-preserving; set `--jitter <pct>`
and `--seed <N>`), or `fixed` (with `--per <amount>`). Use `--reserve-gas` to leave
native for fees.

**Approve a spender**
```bash
node dist/index.js ops describe erc20-approve > approve.json   # edit token/spender/amount
node dist/index.js validate approve.json && node dist/index.js run approve.json --yes
```

**Inspect**
```bash
node dist/index.js balance --chain base --from 0 --to 10
node dist/index.js history --chain base --status success
node dist/index.js chains list           # supported chains + RPC health
```

## Critical rules

1. **Never compute distribute/split amounts yourself.** Use `scaffold distribute`
   with `--split` and `--amount all`; the CLI does sum-preserving BigInt math.
2. **`scan` before you sweep or distribute** — operate on real balances.
3. **`run` without `--yes` is a dry-run.** Inspect, then add `--yes` to broadcast.
4. **`validate` is offline and cheap.** Run it first — it catches schema/.env
   errors before you touch the network or spend gas.
5. **Run `audit` before pushing** any change to a repo containing this tool —
   it scans for committed secrets, bad `.gitignore`, mnemonics, and leaked keys.

## Don't memorize flags — ask the tool

```bash
node dist/index.js <command> --help
node dist/index.js ops describe <type>
node dist/index.js scaffold distribute --help
```

## Going deeper

This SKILL.md is the fast path. Read these from the repo only when you need more:

- **`README.md`** — full command reference, value formats, troubleshooting.
- **`AGENTS.md`** — architecture, internals, how to add a new op or chain.
- **`docs/architecture.png`** — system diagram (inputs → plan → runtime → chains).
