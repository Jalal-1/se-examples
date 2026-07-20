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

## Run

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

Run the same behavior against the complete local v1 stack with:

```bash
./scripts/local-v1.sh up
npm run e2e:v1 -- --profile local-v1
```

The real-network runner also targets Preview and Preprod. See the repository
README for funded-seed, proof-server, and resumable wallet-cache setup. The v1
example is intentionally rejected on Stagenet because that network is on the
separate v2 RC compatibility line.
