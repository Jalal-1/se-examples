# v2 RC toolchain

Dependency island for `local-v2` and Stagenet. It uses the exact v2 RC pins in
`network-profiles/local-v2/network.json`, including ZKIR v3; v1 packages are
rejected by the compatibility guard.

From the repository root:

```bash
npm run install:compiler:v2
npm run install:v2
npm run check:v2
npm run test:v2
```

Generate deployable proving assets with `npm run compile:v2`. The compiler
installer downloads the platform-specific `compactc-v0.33.0-rc.2` release,
verifies its published SHA-256 checksum, and registers it without changing the
default Compact version.

Use the network-neutral runner rather than invoking this toolchain directly:

```bash
npm run e2e -- --example ownable-counter --profile local-v2
npm run e2e -- --example ownable-counter --profile stagenet
```

The second command requires a funded `SE_STAGENET_SEED`. Generated output lives
under `toolchains/v2/artifacts/` and is gitignored.
