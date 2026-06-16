# AGENTS.md — wallet-cli

For AI coding agents (Claude Code, Codex, etc.) working on this repo.
For human-facing docs, see [README.md](./README.md).

## What this is

A **plan-driven TypeScript CLI** for burner wallet operations. One execution
path: a JSON plan → zod validate → simulate → sign → broadcast → log to
`tx-history.jsonl`. The runtime is the product; commands are sugar.

## Architecture

```
src/
├── index.ts                       commander entry, reads version from package.json
├── commands/                      CLI surface (one file per top-level command)
│   ├── run.ts                     → run <plan.json>          (main entry)
│   ├── validate.ts                → validate <plan.json>
│   ├── history.ts                 → history (query tx-history.jsonl)
│   ├── scaffold.ts                → scaffold {sweep,multisend,collect,distribute,csv}
│   ├── scan.ts                    → scan (batch balance reader)
│   ├── tx.ts                      → tx send (legacy, wraps the runtime)
│   ├── balance.ts, wallet.ts, export.ts
│   ├── chains.ts                  chain registry + RPC health
│   ├── collectTokens.ts           token registry CRUD
│   ├── audit.ts                   → audit (pre-push credential scan)
│   └── ops.ts                     list/describe registered op types
│
├── lib/
│   ├── plan/
│   │   ├── schema.ts              zod schema for plan JSON (the contract)
│   │   └── load.ts                loadPlan() — read + validate + parse
│   ├── ops/
│   │   ├── registry.ts            op-type registration (the plugin table)
│   │   ├── context.ts             buildContext() — resolve chain/signer/tokens
│   │   ├── execute.ts             executePlan() — THE runtime
│   │   ├── schedule.ts            bounded-concurrency scheduler (batchSize)
│   │   ├── chainResolve.ts        chain lookup helpers
│   │   └── builtin/               one file per op type
│   │       ├── nativeSend.ts
│   │       ├── erc20Transfer.ts
│   │       ├── erc20Approve.ts
│   │       ├── contractCall.ts
│   │       └── rawTx.ts
│   ├── scaffold/                  one file per generator (writes plan JSON)
│   │   ├── sweep.ts, multisend.ts, collect.ts, csv.ts
│   │   ├── distribute.ts          targets+amounts → distribute plan (pure)
│   │   └── distributeMath.ts      PURE split math: equal/jitter/fixed (BigInt)
│   ├── scan/scan.ts               scanBalances() — batch native+ERC20 reader
│   ├── audit/credentials.ts       runCredentialAudit() — pure 5-check logic
│   ├── abi/builtin.ts             built-in ABI aliases (erc20, erc721, permit2)
│   ├── gas.ts                     EIP-1559 fee estimation
│   ├── nonce.ts                   per-address nonce manager
│   ├── signer.ts                  resolveSigner() — supports env + file sources
│   ├── rpc.ts                     ethers JsonRpcProvider factory
│   ├── tokens.ts                  token registry (seeded + override-merged)
│   ├── chainState.ts              chain overrides + Alchemy RPC resolution
│   ├── txHistory.ts               append + query tx-history.jsonl
│   ├── usd.ts                     USD price cache (file-based, 5min TTL)
│   ├── walletIndex.ts             address → derivation index lookup
│   ├── wallets.ts                 wallet source resolution (env/file)
│   ├── paths.ts                   ALL paths live here (no hardcoded paths)
│   ├── backup.ts                  timestamped file backups
│   └── redact.ts                  safeLog() + redactText() — see gotcha #1
│
├── config/
│   ├── chains.ts                   hardcoded chain registry + public-RPC fallbacks
│   └── alchemy.ts                  chainId → Alchemy slug; builds RPC from ALCHEMY_API_KEY
└── types/chains.ts                Chain type
```

## Build & test

```bash
npm install              # one-time
npm run build            # tsc → dist/
npm run dev -- <cmd>     # run without building (uses tsx)
npm test                 # all unit tests (node:test, 0 deps)
npm run check            # tsc --noEmit on src
npm run check:tests      # tsc --noEmit on src + tests
npm run test:smoke       # dist sanity (chains list + validate)
```

Test count target: **173+**. If you add a new module, add a test file in
`tests/lib/<mirror-of-src-path>/<module>.test.ts`.

## Code conventions

- **ESM-in-CommonJS** project (`"type": "commonjs"` in package.json). Use
  CommonJS imports: `import { x } from "./y"`. TypeScript handles the rest.
- **Zod everywhere.** Input parsing goes through a zod schema. If you find
  yourself `JSON.parse`ing without a schema, you're doing it wrong.
- **Universal value format** is parsed by `parseValueString()` in
  `src/lib/plan/values.ts` (or wherever it lives — `rg "parseValueString"
  src/lib/plan`). Supported prefixes: `wei:`, `raw:`, `usd:`. Special values:
  `all`, `unlimited`. Reuse this for any new op's amount/value field.
- **All paths go through `src/lib/paths.ts`.** No `path.join(__dirname, "..",
  ".env")` in the middle of a file. If you need a new path, add a constant to
  `PATHS` and reference it.
- **Use `safeLog()` for user-facing output** that might include user-supplied
  data. It auto-redacts 64-hex strings and secret-key-named values. Plain
  `console.log` is fine for hardcoded text.
- **Error handling**: throw typed errors, let the commander wrapper handle
  formatting. Don't catch and re-format in command files.
- **Op types** are registered via `registerOp()` in `src/lib/ops/registry.ts`.
  Each op exports a zod schema, a `dryRun` function, and a `broadcast`
  function. See `src/lib/ops/builtin/erc20Transfer.ts` for the canonical
  pattern.

## Common tasks

### Add a new op type

1. Create `src/lib/ops/builtin/<name>.ts` exporting `{ schema, dryRun, broadcast }`
2. Register it in `src/lib/ops/registry.ts` (or wherever the builtins are imported)
3. Add it to the `OpType` union in `src/lib/plan/schema.ts`
4. Update `src/commands/ops.ts` if it shows descriptions
5. Add tests in `tests/lib/ops/builtin/<name>.test.ts`
6. Update README's "Registered op types" table

### Add a new chain

1. Add an entry to `src/config/chains.ts` (chainId, `rpcUrl` = public fallback, type: "evm"|"solana")
2. If Alchemy serves it, add `chainId → slug` to `ALCHEMY_SLUGS` in `src/config/alchemy.ts`
   so an `ALCHEMY_API_KEY` user gets the premium endpoint automatically
3. Add token seeds to `src/lib/tokens.ts` if you have them
4. Test: `node dist/index.js chains list` and `chains test-rpc --chain <name>`

### Add a new scaffold generator

1. Create `src/lib/scaffold/<name>.ts` exporting `scaffoldXxx(opts): Plan`
2. Wire it in `src/commands/scaffold.ts`
3. Tests in `tests/lib/scaffold/<name>.test.ts` — assert it produces a plan
   that passes `planSchema.parse(...)`

### Bump the version

```bash
npm version patch    # or minor / major
```

The CLI reads it at startup from `package.json` — no hardcoded string to update.

## Gotchas (read these before editing)

1. **Redactor source file uses obfuscated key names.** The `SECRET_KEYS` array
   in `src/lib/redact.ts` is built via `.push(_k("priv", "ateKey"))` chunks
   because the source itself triggers upstream display sanitizers that
   pattern-match on literal secret key names. Don't "clean it up" to use
   string literals — the file will get silently corrupted on write. See
   `tests/lib/redact.test.ts` for the contract.

2. **EIP-55 checksum is case-sensitive.** `ethers.getAddress("0x...")`
   returns the proper checksum form. If a user passes an address with mixed
   case in the wrong positions, validation fails. The erc20 op handlers
   lowercase the address before any internal comparison but the schema
   validator may still reject the raw input. Workaround: lowercase before
   passing to `ethers.getAddress`, or document that mixed-case addresses
   must be the canonical checksum form.

3. **Sweep scaffold is the only multi-op generator that doesn't include
   `defaultFromIndex`.** If you copy the sweep generator as a template, the
   resulting plan ops will fall through to `defaultFromIndex` from the plan
   level, which defaults to 0. Check `src/lib/scaffold/sweep.ts:buildOps`
   for the pattern.

4. **`"all"` in `erc20-transfer` is on-chain, not a value prefix.** The
   runtime calls `balanceOf` and replaces the value before simulation. This
   means you can't `validate` a plan that uses `"all"` against a chain you
   can't reach. Use `native-send` for `"all"` if you need dry-run to work
   without RPC.

5. **Token override file is keyed by `(chainId, address)`, not symbol.**
   See `src/lib/tokens.ts:writeOverride()`. If you change the registry format,
   bump `version` in the override schema and add a migration.

6. **`tx-history.jsonl` is append-only.** If you need to "edit" history,
   don't — back up the file, rewrite, and migrate. There are no migrations
   yet, so this is a hypothetical.

7. **The `bin` entry in `package.json` points to `dist/index.js`.** If you
   rename the entry point or change the build output dir, update both
   `bin` and `scripts.start` together.

8. **Don't add new dependencies without checking tree size.** ethers + zod +
   commander + chalk are the core. Everything else should be replaceable with
   a few lines of stdlib (e.g. `cli-table3` for output formatting is
   optional — could be a hand-rolled table).

9. **RPC is resolved at ONE chokepoint: `getChainsWithOverrides()`.** It calls
   `alchemyRpcUrl(chainId)` and falls back to the chain's bundled public RPC if
   `ALCHEMY_API_KEY` is unset OR the chain isn't in `ALCHEMY_SLUGS`. Don't read
   `process.env.ALCHEMY_API_KEY` anywhere else or hardcode an RPC URL in a
   command — every consumer (run/scan/balance/context) routes through this
   function and inherits the resolution for free.

10. **Agents must NOT compute distribute amounts in-model.** `scaffold
    distribute` exists precisely so the CLI does the balance÷N / remainder /
    gas-reserve math in tested BigInt code (`distributeMath.ts`, sum-preserving).
    State intent via flags (`--split`, `--amount all`, `--reserve-gas`); never
    pre-calculate per-wallet amounts and pass them in.

## What NOT to do

- **Never commit `.env`** or any file containing `SEED_PHRASE`. The `.gitignore`
  blocks it, but verify before `git add -A`.
- **Never change the default `--dry-run` to false.** Real sends require
  explicit `--yes` and there's no way to overrule that at the command level.
- **Never skip the simulation step** in `executePlan()`. It catches most
  reverts before they cost gas.
- **Never write a private key to a file in this repo.** The signer is
  in-memory only; if you need to test, use a throwaway mnemonic in `.env`.
- **Never add a network call without a timeout.** `ethers` defaults to
  5min. Wrap with `Promise.race` for the user-facing flows.

## Testing patterns

- Use `node:test` + `node:assert/strict`. No Jest, no Vitest.
- Test files mirror `src/lib/` structure: `tests/lib/<mirror>/<file>.test.ts`
- For scaffold tests, assert `planSchema.parse(plan)` succeeds AND that the
  generated plan contains the expected ops.
- For runtime tests, use a mock provider (see `tests/lib/ops/builtin/erc20.test.ts`
  for the `MockProvider` pattern).
- Always run `npm run check:tests` before committing — it type-checks both
  src and tests.

## Where to ask for help

- Check the project's `SKILL.md` (if the orchestrating agent maintains one) for
  project-specific context and conventions.
- Search prior work/history for past decisions on a given topic before changing
  established patterns.
- The repository owner is the final authority on architectural decisions.
