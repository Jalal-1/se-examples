# se-examples

Network-aware Compact examples and integration tests for Midnight. Each network
profile is a hard compatibility boundary: v1 stable and v2 RC components must
not be mixed.

## Network lanes

| Profile | Topology | Runtime spec/tx | Proof server | Features | State |
| --- | --- | --- | --- | --- | --- |
| `local-v1` | local node + indexer + prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | ready |
| `preview` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | ready |
| `preprod` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | Compact contracts; shielded/unshielded state; native tokens | ready |
| **`stagenet`** | hosted node/indexer + local prover | `2000000` / `4` | `9.0.0-rc.5_experimental` | **USDCx crypto primitives; ECDSA; contract-to-contract calls (phase 1, unshielded); ZKIR v3; cNIGHT→mNIGHT bridge; Keccak; secp256k1; contract events (phase 1, unshielded)** | **ready** |
| `local-v2` | local node + indexer + prover | `2000000` / `4` expected | `9.0.0-rc.5_experimental` | Stagenet feature set except the Cardano bridge | planned |

Exact endpoints, images, SDK/compiler versions, and capabilities live in
`network-profiles/<profile>/network.json`.

Stagenet features above are the delivered
[Q2 beta SoW](https://github.com/Jalal-1/stagenet_testing/blob/main/midnight-2-0-stagenet-beta.md).
ZKIR v3 additionally requires the `--feature-zkir-v3` compiler flag.

## Examples

| Example | OpenZeppelin module | Networks | Coverage |
| --- | --- | --- | --- |
| [`01-ownable-counter`](examples/01-ownable-counter/) | `Ownable` | local-v1, Preview, Preprod | owner-only mutation, rejection, ownership transfer |

## Start local-v1

Requires Docker Compose v2, `curl`, and `jq`. Defaults: node `9944`, indexer
`8088`, proof server `6300`.

```bash
cp infra/local-v1/.env.example infra/local-v1/.env
./scripts/local-v1.sh config
./scripts/local-v1.sh pull
./scripts/local-v1.sh up
```

```bash
./scripts/local-v1.sh ps
./scripts/local-v1.sh smoke
./scripts/local-v1.sh logs
./scripts/local-v1.sh down
```

`up` waits for all services and runs the smoke test. `down` preserves the
profile-scoped node and indexer volumes.

## Use Preview, Preprod, or Stagenet

Set `PROFILE` to `preview`, `preprod`, or `stagenet`:

```bash
PROFILE=preprod
./scripts/hosted-network.sh "$PROFILE" preflight
./scripts/hosted-network.sh "$PROFILE" up
./scripts/hosted-network.sh "$PROFILE" smoke
./scripts/hosted-network.sh "$PROFILE" down
```

`up` performs the remote preflight first, switches only proof servers managed by
this repository, then verifies the selected prover on `127.0.0.1:6300`. An
unrelated container using that port is reported and left untouched.

## Compatibility gates

Before an example runs, the preflight checks:

- live node software, runtime spec, transaction version, and latest block;
- the profile's v4 indexer GraphQL endpoint;
- the local proof-server version when `--proof` or `smoke` is used.

A runtime or prover mismatch fails before compilation or deployment.

## Prepare the v1 toolchain

The v1 npm dependency island is shared by `local-v1`, Preview, and Preprod. It
has its own lockfile and rejects Stagenet/v2 packages.

```bash
npm run install:v1
npm run check:v1
```

OpenZeppelin Compact is pinned to `0.3.0-alpha`; all Midnight packages are
pinned to the exact v1 profile versions. The compiler is pinned independently
by the network profile.

```bash
compact update --no-set-default 0.31.1
npm run test:v1
npm run compile:v1
```

`test:v1` runs fast circuit-level behavior tests without proving keys;
`compile:v1` generates the complete deployable artifacts.

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

## Next step

Add the wallet-backed deployment runner for the Ownable Counter, beginning with
`local-v1` and then reusing the same flow on Preview and Preprod.
