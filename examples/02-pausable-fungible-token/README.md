# Pausable Fungible Token

An unshielded token composed from OpenZeppelin Compact `FungibleToken`,
`Pausable`, and `Ownable`. The owner can pause all token mutations and mint new
supply; holders can transfer, approve a spender, and use `transferFrom`.

## What it verifies

- constructor metadata, ownership, and an initial supply of 1,000;
- direct transfer without changing total supply;
- owner-only pause and mint authorization;
- pause blocks transfer, approval, delegated transfer, and mint;
- approval plus `transferFrom` updates balances and allowance;
- final indexed state: supply 1,050, owner 800, recipient 250, allowance 125.

The complete interface has 15 circuits, which is too large for one deployment
transaction on the tested nodes. Its runner deploys ledger state first, then
adds each verifier key in a separate maintenance transaction. This follows the
[phased deployment pattern demonstrated by EffectStream](https://github.com/effectstream/effectstream/blob/v-next/packages/chains/midnight-contracts/src/deploy-phased.ts).

## Fast local checks

Complete the repository [one-time setup](../../README.md#one-time-setup), then:

```bash
npm run test:v1
npm run test:v2
```

These simulator tests do not submit transactions. Network runs take several
minutes because deployment submits one base transaction and 15 verifier-key
transactions before exercising the token.

## local-v1

```bash
./scripts/local-v1.sh up
npm run e2e -- --example pausable-fungible-token --profile local-v1
./scripts/local-v1.sh down
```

The funded local genesis seed is selected automatically.

## local-v2

```bash
./scripts/local-v2.sh up
npm run e2e -- --example pausable-fungible-token --profile local-v2
./scripts/local-v2.sh down
```

This automatically selects the v2 RC dependencies, ZKIR v3 artifacts, and the
v4 contract-operation format required by the v2 runtime.

## Preview

```bash
./scripts/hosted-network.sh preview up
read -rsp 'Preview wallet seed: ' SE_PREVIEW_SEED; echo
export SE_PREVIEW_SEED
npm run e2e -- --example pausable-fungible-token --profile preview --allow-cold-sync
unset SE_PREVIEW_SEED
./scripts/hosted-network.sh preview down
```

Use `--allow-cold-sync` for the first run. Later runs should omit it and reuse
the checkpoint under `.cache/wallet-state/`.

## Preprod

```bash
./scripts/hosted-network.sh preprod up
read -rsp 'Preprod wallet seed: ' SE_PREPROD_SEED; echo
export SE_PREPROD_SEED
npm run e2e -- --example pausable-fungible-token --profile preprod --allow-cold-sync
unset SE_PREPROD_SEED
./scripts/hosted-network.sh preprod down
```

Set `SE_WALLET_CACHE_DIR` before the run only when reusing an existing,
compatible Preprod wallet checkpoint.

## Stagenet

```bash
./scripts/hosted-network.sh stagenet up
read -rsp 'Stagenet wallet seed: ' SE_STAGENET_SEED; echo
export SE_STAGENET_SEED
npm run e2e -- --example pausable-fungible-token --profile stagenet --allow-cold-sync
unset SE_STAGENET_SEED
./scripts/hosted-network.sh stagenet down
```

Stagenet selects only the v2 RC lane and experimental prover. Never reuse a v1
seed or wallet checkpoint; omit `--allow-cold-sync` after the first successful
checkpointed sync.

Hosted seeds must be funded 64-character hex values. Every run deploys a fresh
contract and spends DUST. Faucets and exact endpoints are recorded under
`network-profiles/`.
