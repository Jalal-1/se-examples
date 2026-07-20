# se-examples

Network-aware Compact examples and integration tests for Midnight. Each network
profile is a hard compatibility boundary: v1 stable and v2 RC components must
not be mixed.

## Network lanes

| Profile | Topology | Runtime spec/tx | Proof server | Features | State |
| --- | --- | --- | --- | --- | --- |
| `local-v1` | local node + indexer + prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | infra + E2E ready |
| `preview` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | infra + E2E ready |
| `preprod` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | infra + E2E ready |
| **`stagenet`** | hosted node/indexer + local prover | `2000000` / `4` | `9.0.0-rc.5_experimental` | **USDCx crypto primitives; ECDSA; contract-to-contract calls (phase 1, unshielded); ZKIR v3; cNIGHT→mNIGHT bridge; Keccak; secp256k1; contract events (phase 1, unshielded)** | **infra ready; v2 E2E pending** |
| `local-v2` | local node + indexer + prover | `2000000` / `4` expected | `9.0.0-rc.5_experimental` | Stagenet feature set except the Cardano bridge | planned |

Exact endpoints, images, SDK/compiler versions, and capabilities live in
`network-profiles/<profile>/network.json`.

Stagenet features above are the delivered
[Q2 beta SoW](https://github.com/Jalal-1/stagenet_testing/blob/main/midnight-2-0-stagenet-beta.md).
ZKIR v3 additionally requires the `--feature-zkir-v3` compiler flag.

## Examples

| Example | OpenZeppelin module | Networks | Coverage |
| --- | --- | --- | --- |
| [`01-ownable-counter`](examples/01-ownable-counter/) | `Ownable` | local-v1, Preview, Preprod; Stagenet pending v2 | owner-only mutation, rejection, ownership transfer |

## Test `01-ownable-counter`

The mini-app deploys an OpenZeppelin Ownable counter, increments it as the
owner, rejects a stranger, transfers ownership, rejects the old owner, and
increments as the new owner. A successful E2E run ends with `final counter=2`.

### One-time setup

Requires Node.js 22+, npm, Docker Compose v2, `curl`, `jq`, and Compact
compiler `0.31.1`:

```bash
compact update --no-set-default 0.31.1
npm run install:v1
npm run check:v1
```

Run the fast circuit simulator before using any network:

```bash
npm run test:v1
```

This validates v1 contract behavior but does not submit a transaction.

### Local v1 — full E2E supported

Start the pinned local node, indexer, and v1 proof server, then run the app:

```bash
cp -n infra/local-v1/.env.example infra/local-v1/.env
./scripts/local-v1.sh up
npm run e2e:v1 -- --profile local-v1
```

The runner uses the public genesis-funded local development seed. Inspect or
stop the stack with:

```bash
./scripts/local-v1.sh ps
./scripts/local-v1.sh logs
./scripts/local-v1.sh down
```

`down` preserves the profile-scoped node and indexer volumes.

### Preview — full E2E supported

Start Preview's pinned v1 proof server, enter a funded Preview seed without
placing it in shell history, then run the app:

```bash
./scripts/hosted-network.sh preview up
read -rsp 'Preview wallet seed: ' SE_PREVIEW_SEED; echo
export SE_PREVIEW_SEED
npm run e2e:v1 -- --profile preview --allow-cold-sync
```

The first uncached run can take a long time and writes resumable state under
`.cache/wallet-state/`. Once a cache exists, omit `--allow-cold-sync`:

```bash
npm run e2e:v1 -- --profile preview
unset SE_PREVIEW_SEED
./scripts/hosted-network.sh preview down
```

Fund the wallet from the Preview faucet recorded in
[`network-profiles/preview/network.json`](network-profiles/preview/network.json).
Each E2E run deploys a new contract and spends test-network DUST.

### Preprod — full E2E supported

Start Preprod's pinned v1 proof server and use a funded Preprod seed:

```bash
./scripts/hosted-network.sh preprod up
read -rsp 'Preprod wallet seed: ' SE_PREPROD_SEED; echo
export SE_PREPROD_SEED
npm run e2e:v1 -- --profile preprod --allow-cold-sync
```

For later runs, reuse the checkpoint and omit `--allow-cold-sync`:

```bash
npm run e2e:v1 -- --profile preprod
unset SE_PREPROD_SEED
./scripts/hosted-network.sh preprod down
```

Fund the wallet from the Preprod faucet recorded in
[`network-profiles/preprod/network.json`](network-profiles/preprod/network.json).
To reuse the existing `midnight-canary` checkpoint, set
`SE_WALLET_CACHE_DIR` to that project's `.cache/wallet-state` directory before
running the command.

### Stagenet — infrastructure test supported; mini-app E2E pending v2

Stagenet is runtime v2 and must use its own experimental proof server. Verify
the complete Stagenet infrastructure lane with:

```bash
./scripts/hosted-network.sh stagenet preflight
./scripts/hosted-network.sh stagenet pull
./scripts/hosted-network.sh stagenet up
./scripts/hosted-network.sh stagenet smoke
```

This checks Stagenet's hosted node and indexer plus the local
`9.0.0-rc.5_experimental` proof server. Shut it down with:

```bash
./scripts/hosted-network.sh stagenet down
```

Do **not** run `e2e:v1` against Stagenet. The Ownable mini-app is not yet
deployable there because the repository does not yet contain the isolated v2
dependency lane (`midnight-js` 5, wallet SDK 2, ledger v9, Compact
`0.33.0-rc.1` with ZKIR v3). OpenZeppelin Compact `0.3.0-alpha` is also not
declared compatible with this v2 RC lane. The v1 runner rejects `stagenet`
instead of mixing incompatible dependencies.

### Local v2 — planned, not runnable

`local-v2` has a pinned profile but no Compose stack or v2 toolchain yet. Use
`local-v1` for local E2E testing. Local v2 instructions will be added when the
matching v2 node, indexer, prover, compiler, and wallet lane is implemented.

### Compatibility gates

Every network command checks the live node runtime, transaction version,
latest block, v4 indexer, and selected proof-server version before deployment.
A mismatch fails closed. Starting a hosted lane switches only proof servers
managed by this repository; an unrelated process using port `6300` is reported
and left untouched.

## Repository map

- `network-profiles/` — pinned network configuration and capabilities.
- `examples/` — small feature-focused Compact contracts and manifests.
- `schemas/` — network-profile and example-manifest contracts.
- `infra/local-v1/` — complete v1 local stack.
- `infra/hosted/` — profile-selected local proof server.
- `toolchains/v1/` — isolated v1 npm manifest and lockfile.
- `scripts/local-v1.sh` — local stack lifecycle.
- `scripts/hosted-network.sh` — hosted-network lifecycle and switching.
- `scripts/preflight-network.sh` — live compatibility validation.

## Safety rules

- Images and dependencies are pinned; no `latest` tags.
- v1 stable and v2 RC use separate package manifests and lockfiles.
- Wallet state, mnemonics, secrets, generated artifacts, and reports stay out
  of Git.
- Infrastructure does not create or fund wallets.
- Hosted seeds are accepted only through network-specific environment variables;
  they are never CLI arguments or log output.

## Next step

Add the isolated v2 RC toolchain and a Stagenet-native example, then mirror that
lane into `local-v2` when a matching local stack is available.
