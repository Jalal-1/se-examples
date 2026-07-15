# se-examples

Network-aware Compact examples and integration tests for Midnight. Each network
profile is a hard compatibility boundary: v1 stable and v2 RC components must
not be mixed.

## Network lanes

| Profile | Topology | Runtime spec/tx | Proof server | Contract-to-contract | State |
| --- | --- | --- | --- | --- | --- |
| `local-v1` | local node + indexer + prover | `1000000` / `3` | `8.1.0` | no | ready |
| `preview` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | no | ready |
| `preprod` | hosted node/indexer + local prover | `1000000` / `3` | `8.1.0` | no | ready |
| `stagenet` | hosted node/indexer + local prover | `2000000` / `4` | `9.0.0-rc.5_experimental` | yes | ready |
| `local-v2` | local node + indexer + prover | `2000000` / `4` expected | `9.0.0-rc.5_experimental` | yes | planned |

Exact endpoints, images, SDK/compiler versions, and capabilities live in
`network-profiles/<profile>/network.json`.

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

## Repository map

- `network-profiles/` — pinned network configuration and capabilities.
- `schemas/` — network-profile and example-manifest contracts.
- `infra/local-v1/` — complete v1 local stack.
- `infra/hosted/` — profile-selected local proof server.
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

Create the v1 example workspace, install the exact OpenZeppelin Compact alpha,
and add the first small contract feature test.
