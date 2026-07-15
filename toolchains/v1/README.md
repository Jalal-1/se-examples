# v1 stable toolchain

Dependency island for `local-v1`, Preview, and Preprod. Its exact pins come
from `network-profiles/local-v1/network.json`; Stagenet/v2 packages are rejected
by the compatibility guard.

```bash
npm run install:v1
npm run check:v1
```

The Compact compiler is an external tool and remains pinned to `0.31.1` by the
network profile. `compile:v1` and `test:v1` intentionally remain unavailable
until the first example is added.
