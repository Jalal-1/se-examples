# v1 stable toolchain

Dependency island for `local-v1`, Preview, and Preprod. Its exact pins come
from `network-profiles/local-v1/network.json`; Stagenet/v2 packages are rejected
by the compatibility guard.

```bash
npm run install:v1
npm run check:v1
```

The Compact compiler is an external tool and remains pinned to `0.31.1` by the
network profile. Install that version without changing another project's
default compiler:

```bash
compact update --no-set-default 0.31.1
```

From the repository root, run the v1 examples with:

```bash
npm run test:v1       # compile without proving keys, then run circuit tests
npm run compile:v1    # generate complete deployable artifacts
npm run e2e -- --example ownable-counter --profile local-v1
npm run e2e -- --example pausable-fungible-token --profile local-v1
```

Generated output lives in `toolchains/v1/artifacts/` and is gitignored.
The network-neutral E2E runner selects this lane for `local-v1`, `preview`, and
`preprod`; it selects the isolated v2 lane for v2 profiles. Hosted seeds use
`SE_PREVIEW_SEED` or `SE_PREPROD_SEED`, while wallet sync checkpoints remain
under the gitignored `.cache/wallet-state/`.
