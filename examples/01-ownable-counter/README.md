# Ownable Counter

Smallest useful integration of OpenZeppelin `Ownable`: the owner proves
knowledge of a private 32-byte secret before incrementing a public counter.
The secret never enters the ledger; the stored owner is its persistent hash.

## What it verifies

- the constructor initializes OpenZeppelin ownership;
- the owner can increment public state;
- a different secret is rejected without changing the counter;
- ownership transfer revokes the old owner and authorizes the new owner.

The manifest targets the v1-stable `local-v1`, `preview`, and `preprod` lanes.
The shared compatibility check rejects the example if any target profile or
OpenZeppelin pin drifts out of that lane.

## Network support

| Network | Infrastructure | Ownable Counter E2E | Command |
| --- | --- | --- | --- |
| `local-v1` | ready | supported | `npm run e2e:v1 -- --profile local-v1` |
| `preview` | ready | supported | `npm run e2e:v1 -- --profile preview` |
| `preprod` | ready | supported | `npm run e2e:v1 -- --profile preprod` |
| `stagenet` | ready | pending isolated v2 toolchain | infrastructure commands only |
| `local-v2` | planned | not runnable | none yet |

## Fast simulator

From the repository root:

```bash
npm run install:v1
npm run test:v1
```

The test command compiles without proving keys and runs the circuits against
the Compact runtime simulator. Generate deployable proving artifacts with:

```bash
npm run compile:v1
```

Generated files are written under `toolchains/v1/artifacts/` and stay out of
Git. The witness in the test harness is demonstration code, not an audited
production key-management implementation.

## Local v1

```bash
./scripts/local-v1.sh up
npm run e2e:v1 -- --profile local-v1
./scripts/local-v1.sh down
```

Expected result: deployment succeeds, unauthorized calls are rejected,
ownership moves to the new secret, and the final counter is `2`.

## Preview

```bash
./scripts/hosted-network.sh preview up
read -rsp 'Preview wallet seed: ' SE_PREVIEW_SEED; echo
export SE_PREVIEW_SEED
npm run e2e:v1 -- --profile preview --allow-cold-sync
unset SE_PREVIEW_SEED
./scripts/hosted-network.sh preview down
```

The seed must be funded on Preview. Use `--allow-cold-sync` for the first run;
omit it later to require and reuse the saved wallet checkpoint.

## Preprod

```bash
./scripts/hosted-network.sh preprod up
read -rsp 'Preprod wallet seed: ' SE_PREPROD_SEED; echo
export SE_PREPROD_SEED
npm run e2e:v1 -- --profile preprod --allow-cold-sync
unset SE_PREPROD_SEED
./scripts/hosted-network.sh preprod down
```

The seed must be funded on Preprod. An existing compatible wallet checkpoint
can be selected with `SE_WALLET_CACHE_DIR`; omit `--allow-cold-sync` when the
cache is already present.

## Stagenet

The app cannot yet be deployed to Stagenet: Stagenet uses the v2 RC runtime,
while this OpenZeppelin example and runner are pinned to v1. You can and should
still validate the Stagenet infrastructure lane:

```bash
./scripts/hosted-network.sh stagenet preflight
./scripts/hosted-network.sh stagenet up
./scripts/hosted-network.sh stagenet smoke
./scripts/hosted-network.sh stagenet down
```

Do not substitute `--profile stagenet` into `e2e:v1`; it intentionally fails.
Full app coverage requires the separate v2 toolchain and a Stagenet-compatible
contract build.

## Local v2

Not runnable yet. The profile is planned, but the repository has no local v2
Compose stack or isolated v2 application runner. Use `local-v1` until that lane
is implemented.
