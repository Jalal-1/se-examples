import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { inMemoryPrivateStateProvider } from '@midnight-ntwrk/testkit-js';

import { firstSyncedState } from './wallet.mjs';

const createWalletProvider = async (context) => {
  const state = await firstSyncedState(context.wallet, 60_000);
  const balance = async (method, transaction, ttl) => {
    const recipe = await context.wallet[method](
      transaction,
      {
        shieldedSecretKeys: context.shieldedSecretKeys,
        dustSecretKey: context.dustSecretKey,
      },
      { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) },
    );
    const signed = await context.wallet.signRecipe(recipe, (payload) =>
      context.unshieldedKeystore.signData(payload),
    );
    return context.wallet.finalizeRecipe(signed);
  };
  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () =>
      state.shielded.encryptionPublicKey.toHexString(),
    balanceTx: (transaction, ttl) =>
      balance('balanceUnboundTransaction', transaction, ttl),
    balanceUnprovenTx: (transaction, ttl) =>
      balance('balanceUnprovenTransaction', transaction, ttl),
    submitTx: (transaction) => context.wallet.submitTransaction(transaction),
  };
};

export const configureProviders = async (context, profile, zkConfigPath) => {
  const walletProvider = await createWalletProvider(context);
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  return {
    privateStateProvider: inMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(
      profile.endpoints.indexer,
      profile.endpoints.indexerWs,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      profile.endpoints.proofServer,
      zkConfigProvider,
    ),
    walletProvider,
    midnightProvider: walletProvider,
  };
};
