# se-examples

OpenZeppelin Compact mini-apps that run against every compatible Midnight
network. Network profiles are hard compatibility boundaries: v1 stable and v2
RC dependencies never share a package manifest, lockfile, compiler, or runner.

## Universal mini-app rule

Every mini-app declares the capabilities it needs and supplies an implementation
for every matching compatibility line. `npm run check` evaluates it against
every active profile:

- if the profile has all required capabilities, the app must build and run there;
- exclusion is allowed only when the profile lacks a declared capability;
- dependency and OpenZeppelin pins must exactly match the selected profile.

For example, a contract-to-contract app is correctly excluded from v1 because
those profiles lack `contract-to-contract`; it must run on both `local-v2` and
`stagenet`. Adding an active capable network without adding app coverage makes
the repository check fail.

## Network lanes

| Profile | Stack | Line | Distinguishing features | Mini-app runner |
| --- | --- | --- | --- | --- |
| `local-v1` | local node, indexer, prover | v1 stable | baseline Compact, shielded/unshielded state, native tokens | ready |
| `preview` | public node/indexer, local prover | v1 stable | baseline public test network | ready |
| `preprod` | public node/indexer, local prover | v1 stable | baseline public test network | ready |
| `local-v2` | local node, indexer, prover | v2 RC | C2C, events, ZKIR v3, Keccak, secp256k1, ECDSA | ready |
| `stagenet` | public node/indexer, local prover | v2 RC | Local v2 features plus the Cardano bridge | ready |

Exact endpoints, images, dependency versions, and capabilities live in
`network-profiles/<profile>/network.json`. The Stagenet pins and feature set are
derived from the [Midnight 2.0 beta SoW](https://github.com/Jalal-1/stagenet_testing/blob/main/midnight-2-0-stagenet-beta.md).

## Mini-apps

| ID | OpenZeppelin module | Required capabilities | Networks |
| --- | --- | --- | --- |
| [`ownable-counter`](examples/01-ownable-counter/) | `Ownable` | Compact contracts, shielded state, unshielded state | all five profiles |

The universal invocation is:

```bash
npm run e2e -- --example ownable-counter --profile <profile>
```

The profile automatically selects the isolated v1 or v2 toolchain. A successful
Ownable Counter run deploys a contract, checks owner and non-owner calls,
transfers ownership, and ends with `final counter=2`.

## One-time setup

Requires Node.js 22+, npm, Docker Compose v2, the Compact CLI, `curl`, `jq`, and
`unzip`.

```bash
# v1 compiler used by local-v1, Preview, and Preprod
compact update --no-set-default 0.31.1

# checksum-verified v2 RC compiler used by local-v2 and Stagenet
npm run install:compiler:v2

# isolated dependency sets
npm run install:v1
npm run install:v2

# pins, capability coverage, and fast circuit simulators
npm run check
npm test
```

`npm test` does not submit transactions. Full E2E runs compile proving assets
automatically.

## Run on local-v1

```bash
cp -n infra/local-v1/.env.example infra/local-v1/.env
./scripts/local-v1.sh pull
./scripts/local-v1.sh up
npm run e2e -- --example ownable-counter --profile local-v1
```

The runner uses the funded public development genesis seed. Manage the stack
with `./scripts/local-v1.sh ps`, `logs`, or `down`; `down` preserves its named
volumes. Local v1 and Local v2 share host ports, so starting either one safely
stops the other.

## Run on local-v2

```bash
cp -n infra/local-v2/.env.example infra/local-v2/.env
./scripts/local-v2.sh pull
./scripts/local-v2.sh up
npm run e2e -- --example ownable-counter --profile local-v2
```

This runs the Stagenet-compatible node `2.0.0-rc.4`, v4 indexer, and
`9.0.0-rc.5_experimental` prover locally with ZKIR v3 artifacts. Manage it with
`./scripts/local-v2.sh ps`, `logs`, or `down`; volumes are preserved by `down`.

## Run on Preview

Use a funded 64-character hex seed. The local proof server is pinned to the v1
lane; the node and indexer are public.

```bash
./scripts/hosted-network.sh preview up
read -rsp 'Preview wallet seed: ' SE_PREVIEW_SEED; echo
export SE_PREVIEW_SEED
npm run e2e -- --example ownable-counter --profile preview --allow-cold-sync
```

The first run writes a resumable wallet checkpoint under `.cache/wallet-state/`.
On later runs, omit `--allow-cold-sync` so a missing or invalid checkpoint fails
closed:

```bash
npm run e2e -- --example ownable-counter --profile preview
unset SE_PREVIEW_SEED
./scripts/hosted-network.sh preview down
```

The faucet is recorded in
[`network-profiles/preview/network.json`](network-profiles/preview/network.json).

## Run on Preprod

```bash
./scripts/hosted-network.sh preprod up
read -rsp 'Preprod wallet seed: ' SE_PREPROD_SEED; echo
export SE_PREPROD_SEED
npm run e2e -- --example ownable-counter --profile preprod --allow-cold-sync
```

Reuse the checkpoint on subsequent runs:

```bash
npm run e2e -- --example ownable-counter --profile preprod
unset SE_PREPROD_SEED
./scripts/hosted-network.sh preprod down
```

The faucet is recorded in
[`network-profiles/preprod/network.json`](network-profiles/preprod/network.json).
To reuse a compatible checkpoint from another project, set
`SE_WALLET_CACHE_DIR` to its `.cache/wallet-state` directory.

## Run on Stagenet

Stagenet uses the v2 RC lane and experimental local prover. Use a funded
Stagenet seed; do not reuse a v1 network seed or wallet checkpoint.

```bash
./scripts/hosted-network.sh stagenet up
read -rsp 'Stagenet wallet seed: ' SE_STAGENET_SEED; echo
export SE_STAGENET_SEED
npm run e2e -- --example ownable-counter --profile stagenet --allow-cold-sync
```

Reuse the Stagenet checkpoint on later runs:

```bash
npm run e2e -- --example ownable-counter --profile stagenet
unset SE_STAGENET_SEED
./scripts/hosted-network.sh stagenet down
```

The faucet is recorded in
[`network-profiles/stagenet/network.json`](network-profiles/stagenet/network.json).
Each hosted-network E2E run deploys a new contract and spends test-network DUST.

## Diagnostics and safety

- `./scripts/local-v1.sh smoke`, `./scripts/local-v2.sh smoke`, or
  `./scripts/hosted-network.sh <profile> smoke` checks the selected live
  runtime, transaction version, indexer API, and prover without submitting.
- `SE_DEBUG_ERRORS=1` adds a stack trace to E2E failures.
- Hosted wallet state is checkpointed during long syncs and at shutdown.
- Seeds are read only from network-specific environment variables and are never
  accepted as CLI arguments or logged.
- Images and dependencies are exact pins; no `latest` tags are used.
- Starting a lane switches only proof servers managed by this repository. An
  unrelated process on port `6300` is reported and left untouched.

## Repository map

- `examples/` — contracts, manifests, and per-app runbooks.
- `network-profiles/` — endpoints, pins, and capability declarations.
- `toolchains/v1/`, `toolchains/v2/` — isolated npm and execution lanes.
- `infra/local-v1/`, `infra/local-v2/`, `infra/hosted/` — pinned stacks.
- `scripts/run-example.mjs` — capability-aware network-neutral runner.
- `scripts/preflight-network.sh` — live compatibility gate.
