# Ownable Counter

The owner proves knowledge of a private 32-byte secret before incrementing a
public counter. The secret never enters the ledger; OpenZeppelin `Ownable`
stores its persistent hash.

## What it verifies

- construction initializes the owner and counter;
- the owner can increment public state;
- a different secret is rejected without changing state;
- transfer revokes the old owner and authorizes the new owner.

The app requires `compact-contracts`, `shielded-state`, and `unshielded-state`.
All five active profiles provide those capabilities, so the manifest supplies
both v1-stable and v2-RC builds from the same Compact source. `npm run check`
will fail if any capable active network loses coverage.

## Fast local checks

Complete the repository [one-time setup](../../README.md#one-time-setup), then:

```bash
npm run test:v1
npm run test:v2
```

These simulator tests do not submit transactions. Every real-network command
below uses the same capability-aware entry point and should finish with
`final counter=2`.

## local-v1

```bash
./scripts/local-v1.sh up
npm run e2e -- --example ownable-counter --profile local-v1
./scripts/local-v1.sh down
```

The local funded genesis seed is selected automatically.

## local-v2

```bash
./scripts/local-v2.sh up
npm run e2e -- --example ownable-counter --profile local-v2
./scripts/local-v2.sh down
```

This selects the v2 RC dependencies, ZKIR v3 compiler path, and experimental
prover automatically. The local funded genesis seed is selected automatically.

## Preview

```bash
./scripts/hosted-network.sh preview up
read -rsp 'Preview wallet seed: ' SE_PREVIEW_SEED; echo
export SE_PREVIEW_SEED
npm run e2e -- --example ownable-counter --profile preview --allow-cold-sync
unset SE_PREVIEW_SEED
./scripts/hosted-network.sh preview down
```

The seed must be funded on Preview. Use `--allow-cold-sync` only for the first
run; omit it later to require and reuse the saved wallet checkpoint.

## Preprod

```bash
./scripts/hosted-network.sh preprod up
read -rsp 'Preprod wallet seed: ' SE_PREPROD_SEED; echo
export SE_PREPROD_SEED
npm run e2e -- --example ownable-counter --profile preprod --allow-cold-sync
unset SE_PREPROD_SEED
./scripts/hosted-network.sh preprod down
```

The seed must be funded on Preprod. Set `SE_WALLET_CACHE_DIR` before the run if
you need to reuse an existing compatible Preprod checkpoint.

## Stagenet

```bash
./scripts/hosted-network.sh stagenet up
read -rsp 'Stagenet wallet seed: ' SE_STAGENET_SEED; echo
export SE_STAGENET_SEED
npm run e2e -- --example ownable-counter --profile stagenet --allow-cold-sync
unset SE_STAGENET_SEED
./scripts/hosted-network.sh stagenet down
```

The seed must be funded on Stagenet. This command selects the v2 RC dependency
lane and experimental prover; never substitute v1 packages. Omit
`--allow-cold-sync` after the first checkpointed sync.

Hosted seeds must be exactly 64 hex characters and are read only from their
network-specific environment variable. Faucets and exact endpoints are in each
profile under `network-profiles/`.
