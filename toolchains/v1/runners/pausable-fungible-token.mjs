import * as compactJs from '@midnight-ntwrk/compact-js';
import * as compactRuntime from '@midnight-ntwrk/compact-runtime';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as midnightContracts from '@midnight-ntwrk/midnight-js/contracts';
import * as networkIdApi from '@midnight-ntwrk/midnight-js/network-id';
import * as midnightTypes from '@midnight-ntwrk/midnight-js/types';

import {
  Contract,
  ledger as readLedger,
} from '../artifacts/pausable-fungible-token/contract/index.js';
import {
  errorText,
  runPausableFungibleToken,
} from '../../common/pausable-fungible-token-runner.mjs';
import { configureProviders } from '../network/providers.mjs';
import * as walletApi from '../network/wallet.mjs';

runPausableFungibleToken({
  compatibilityLine: 'v1-stable',
  toolchainDirectory: 'v1',
  supportedProfiles: ['local-v1', 'preview', 'preprod'],
  compactJs,
  compactRuntime,
  ledger,
  midnightTypes,
  ledgerApi: ledger,
  midnightContracts,
  networkIdApi,
  operationVersion: 'v3',
  Contract,
  readLedger,
  configureProviders,
  walletApi,
}).catch((error) => {
  console.error(`[e2e] FAIL: ${errorText(error)}`);
  if (process.env.SE_DEBUG_ERRORS === '1') console.error(error.stack);
  process.exitCode = 1;
});
