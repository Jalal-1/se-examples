# se-examples

Network-aware Compact solution examples and integration tests for Midnight.

The repository deliberately treats each Midnight environment as an explicit
compatibility profile. Preview, Preprod, and Stagenet are not interchangeable:
they can use different node runtimes, proof servers, compilers, SDKs, and
language features.

## Current scope

The repository defines the network and example-manifest contracts and provides
the first runnable infrastructure lane: the complete `local-v1` development
stack. It does not yet contain application dependencies, generated artifacts,
wallets, or example applications.

| Profile | Mode | Compatibility line | Status | Purpose |
| --- | --- | --- | --- | --- |
| `local-v1` | local full stack | v1 stable | planned | Fast isolated development for Preview/Preprod-compatible apps |
| `preview` | hosted node/indexer + local prover | v1 stable | active | Early hosted-network integration |
| `preprod` | hosted node/indexer + local prover | v1 stable | active | Final validation before Mainnet |
| `stagenet` | hosted node/indexer + local prover | v2 RC | active | New v2 features, including contract-to-contract calls |
| `local-v2` | local full stack | v2 RC | planned | Local Stagenet-compatible development once the stack is wired |

## Design rules

- Every component version is pinned; no `latest` Docker tags.
- Stable v1 and v2 RC dependencies will use separate package manifests and
  lockfiles.
- Compiler outputs, wallet state, and reports are isolated by network profile.
- A profile preflight must verify the live runtime identity before a test runs.
- Each example declares its compatible profiles and required capabilities.
- Unsupported combinations fail before compilation or deployment.
- Secrets and wallet state never belong in Git.

## Files

- `schemas/network-profile.schema.json` defines a network profile.
- `schemas/example-manifest.schema.json` defines an example's compatibility
  requirements.
- `network-profiles/capabilities.json` is the capability vocabulary.
- `network-profiles/*/network.json` contains the pinned configuration for each
  environment.
- `infra/local-v1/compose.yaml` runs the v1 node, indexer, and proof server.
- `scripts/local-v1.sh` is the supported entry point for the local-v1 stack.

## Run local-v1

The default ports are node `9944`, indexer `8088`, and proof server `6300`.
Only one profile can own those ports at a time.

```bash
cp infra/local-v1/.env.example infra/local-v1/.env
./scripts/local-v1.sh config
./scripts/local-v1.sh pull
./scripts/local-v1.sh up
```

`up` waits for all three services and runs a smoke test that verifies runtime
spec `1000000`, transaction version `3`, the v4 GraphQL endpoint, and proof
server `8.1.0`.

```bash
./scripts/local-v1.sh ps
./scripts/local-v1.sh logs
./scripts/local-v1.sh down
```

`down` preserves the profile's isolated `node-data` and `indexer-data` Docker
volumes. No wallet seed or account mnemonic is supplied by this stack.

## Next step

Add profile-aware hosted-network prover controls and runtime preflights for
Preview, Preprod, and Stagenet.
