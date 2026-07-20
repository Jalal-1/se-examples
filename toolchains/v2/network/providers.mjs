import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { firstSyncedState } from './wallet.mjs';

const addressKey = (address) =>
  typeof address === 'string' ? address : Buffer.from(address).toString('hex');

const inMemoryPrivateStateProvider = () => {
  const privateStates = new Map();
  const signingKeys = new Map();
  let contractAddress;
  const scopedStates = () => {
    if (contractAddress === undefined) {
      throw new Error('Private-state contract address has not been set.');
    }
    const key = addressKey(contractAddress);
    if (!privateStates.has(key)) privateStates.set(key, new Map());
    return privateStates.get(key);
  };
  return {
    setContractAddress(address) {
      contractAddress = address;
    },
    async set(id, state) {
      scopedStates().set(id, state);
    },
    async get(id) {
      return scopedStates().get(id) ?? null;
    },
    async remove(id) {
      scopedStates().delete(id);
    },
    async clear() {
      scopedStates().clear();
    },
    async setSigningKey(address, signingKey) {
      signingKeys.set(addressKey(address), signingKey);
    },
    async getSigningKey(address) {
      return signingKeys.get(addressKey(address)) ?? null;
    },
    async removeSigningKey(address) {
      signingKeys.delete(addressKey(address));
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },
  };
};

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
    const signed = await context.wallet.signRecipe(
      recipe,
      context.unshieldedKeystore.signDataAsync,
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
