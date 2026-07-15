# se-examples

Network-aware Compact solution examples and integration tests for Midnight.

The repository deliberately treats each Midnight environment as an explicit
compatibility profile. Preview, Preprod, and Stagenet are not interchangeable:
they can use different node runtimes, proof servers, compilers, SDKs, and
language features.

## Current scope

This bootstrap defines the network and example-manifest contracts only. It does
not yet contain Docker stacks, application dependencies, generated artifacts,
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

## Next step

Add the `local-v1` Docker Compose stack for node `1.0.0`, indexer `4.3.3`,
and proof server `8.1.0`, with health checks and isolated persistent volumes.
