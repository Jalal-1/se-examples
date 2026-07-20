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
```

Generated output lives in `toolchains/v1/artifacts/` and is gitignored.
