# Install & Bootstrap — for AI agents

Read this once to install `wallet-cli` and run it. It is self-contained: you do
not need the full `README.md` or any external skill doc to get a working tool.
Reach for `AGENTS.md` (architecture/internals) or the README (full command
reference) only when you need depth this file doesn't cover.

## TL;DR

```bash
git clone https://github.com/oxkage/wallet-cli.git
cd wallet-cli
npm install
npm run build
node dist/index.js --help        # verify install
```

Then create `.env` (see below) and you can run plans.

## Requirements

- Node.js >= 18 (developed on Node 22). `git` on PATH.
- No global install needed — invoke via `node dist/index.js <command>`.
  Optionally `npm link` to get a global `wallet-cli` binary.

## Configure (.env)

Copy the template and fill two values. Everything else is optional.

```bash
cp .env.example .env
```

```ini
SEED_PHRASE="your twelve or twenty-four word mnemonic"
ALCHEMY_API_KEY="your-alchemy-key"    # one key powers RPC for every chain
```

- `SEED_PHRASE` — BIP-39 mnemonic; all EVM wallets derive from it.
- `ALCHEMY_API_KEY` — one key builds the RPC URL for every supported chain.
  Unsupported chains fall back to a bundled public RPC automatically.
  Without it, everything still works on public RPCs (slower, rate-limited).
- Never commit `.env`. It is gitignored. Run `node dist/index.js audit` before
  any push.

## Verify it works

```bash
node dist/index.js chains list           # should print the chain table
node dist/index.js validate              # checks .env (no RPC needed)
npm run test:smoke                       # built-dist sanity check
```

## The mental model (so you use it correctly)

A transaction is **data, not code**. You never hand-write transaction logic and
you never compute token amounts in your head. The flow is always:

```
scan (read balances) → scaffold (generate plan JSON) → run (execute)
```

`run` is **dry-run by default**. Add `--yes` only when you intend to broadcast.

## Command cheatsheet

| Command | Purpose |
| --- | --- |
| `run [plan]` | Execute a plan. Dry-run unless `--yes`. |
| `validate [plan]` | Schema + `.env` check, offline. Run first. |
| `scan` | Batch-read native + token balances over a wallet index range. |
| `scaffold sweep\|multisend\|collect\|distribute\|csv` | Generate plan JSON (never broadcasts). |
| `ops list` / `ops describe <type>` | Discover the 5 op types live. |
| `balance` / `history` | Inspect balances / the action log. |
| `chains list` / `chains test-rpc` | Chain registry + RPC health. |
| `collect-tokens` | Manage the per-chain ERC-20 token registry. |
| `audit` | Pre-push credential scan (run before every push). |

## Critical rules for agents

1. **Never compute distribute amounts yourself.** Use `scaffold distribute`
   with `--split equal|jitter|fixed` and `--amount all`; the CLI does the
   sum-preserving BigInt math.
2. **`scan` before you sweep/distribute** — read real balances, don't guess.
3. **`run` without `--yes` is a dry-run.** Inspect the output, then re-run with
   `--yes` to broadcast.
4. **`validate` is offline and cheap.** Run it first to catch schema/.env
   errors before touching the network.
5. **Run `audit` before pushing** any change to a repo containing this tool.

## Self-describe instead of guessing

Don't memorize flags — ask the tool:

```bash
node dist/index.js <command> --help
node dist/index.js ops list
node dist/index.js ops describe erc20-transfer
node dist/index.js scaffold distribute --help
```

## When to load more context

- **Architecture, internals, how to extend** → `AGENTS.md`
- **Full command reference, recipes, value formats, troubleshooting** → `README.md`
- **Just installing and running** → you're already done with this file.
