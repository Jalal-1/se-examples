import * as compactJs from '@midnight-ntwrk/compact-js';
import * as compactRuntime from '@midnight-ntwrk/compact-runtime';
import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';
import * as ledger from '@midnightntwrk/ledger-v9';

import {
  Contract,
  ledger as readLedger,
} from '../artifacts/ownable-counter/contract/index.js';
import { errorText, runOwnableCounter } from '../../common/ownable-counter-runner.mjs';
import { configureProviders } from '../network/providers.mjs';
import * as walletApi from '../network/wallet.mjs';

runOwnableCounter({
  compatibilityLine: 'v2-rc',
  toolchainDirectory: 'v2',
  supportedProfiles: ['local-v2', 'stagenet'],
  compactJs,
  compactRuntime,
  ledger,
  deployContract,
  Contract,
  readLedger,
  configureProviders,
  walletApi,
}).catch((error) => {
  console.error(`[e2e] FAIL: ${errorText(error)}`);
  if (process.env.SE_DEBUG_ERRORS === '1') console.error(error.stack);
  process.exitCode = 1;
});
