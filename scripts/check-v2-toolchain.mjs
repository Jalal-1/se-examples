import { checkToolchain } from './lib/check-toolchain.mjs';

checkToolchain({
  compatibilityLine: 'v2-rc',
  profileId: 'local-v2',
  toolchainDirectory: 'v2',
  requiredPins: [
    ['dependencies', 'compactJs'],
    ['dependencies', 'compactRuntime'],
    ['dependencies', 'ledger'],
    ['dependencies', 'midnightJs'],
    ['dependencies', 'httpClientProofProvider'],
    ['dependencies', 'indexerPublicDataProvider'],
    ['dependencies', 'nodeZkConfigProvider'],
    ['dependencies', 'walletSdk'],
    ['dependencies', 'openzeppelinCompact'],
  ],
  forbiddenPackages: [
    '@midnight-ntwrk/ledger-v8',
    '@midnightntwrk/ledger-v8',
    '@midnight-ntwrk/onchain-runtime-v3',
  ],
});
