import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import {
  createKeystore,
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  Roles,
  ShieldedWallet,
  TransactionHistoryStorage,
  UnshieldedWallet,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'node:buffer';

import {
  deleteWalletState,
  loadWalletState,
  saveWalletState,
  walletCacheDescription,
} from './wallet-state-cache.mjs';

export const LOCAL_GENESIS_SEED = '0'.repeat(63) + '1';
export const DEFAULT_RESTORED_SYNC_TIMEOUT_MS = 15 * 60_000;

const websocketUrl = (httpUrl) => httpUrl.replace(/^http/, 'ws');

const fetchChainFingerprint = async (nodeUrl, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'chain_getBlockHash',
        params: [0],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const value = await response.json();
    return typeof value.result === 'string' && value.result.length > 0
      ? value.result
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const deriveKeysFromSeed = (seed) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize the wallet from the supplied seed.');
  }
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') {
    throw new Error('Failed to derive wallet keys.');
  }
  hdWallet.hdWallet.clear();
  return result.keys;
};

const walletConfiguration = (profile) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: profile.endpoints.indexer,
    indexerWsUrl: profile.endpoints.indexerWs,
  },
  provingServerUrl: new URL(profile.endpoints.proofServer),
  relayURL: new URL(profile.endpoints.nodeWs ?? websocketUrl(profile.endpoints.node)),
  txHistoryStorage: new InMemoryTransactionHistoryStorage(
    TransactionHistoryStorage.TransactionHistoryCommonSchema,
  ),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
});

const waitForState = (wallet, predicate, timeoutMs, description) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let subscription;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      subscription?.unsubscribe();
      callback(value);
    };
    if (timeoutMs !== undefined) {
      timer = setTimeout(
        () =>
          finish(
            reject,
            new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`),
          ),
        timeoutMs,
      );
    }
    subscription = wallet.state().subscribe({
      next: (state) => {
        try {
          if (predicate(state)) finish(resolve, state);
        } catch (error) {
          finish(reject, error);
        }
      },
      error: (error) => finish(reject, error),
    });
    if (settled) subscription.unsubscribe();
  });

export const firstSyncedState = (wallet, timeoutMs) =>
  waitForState(wallet, (state) => state.isSynced, timeoutMs, 'wallet sync');

const startFacade = async (
  profile,
  shieldedSecretKeys,
  dustSecretKey,
  unshieldedKeystore,
  snapshot,
) => {
  const configuration = walletConfiguration(profile);
  const wallet = await WalletFacade.init({
    configuration,
    shielded: (config) =>
      snapshot
        ? ShieldedWallet(config).restore(snapshot.shielded)
        : ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (config) =>
      snapshot
        ? UnshieldedWallet(config).restore(snapshot.unshielded)
        : UnshieldedWallet(config).startWithPublicKey(
            PublicKey.fromKeyStore(unshieldedKeystore),
          ),
    dust: (config) =>
      snapshot
        ? DustWallet(config).restore(snapshot.dust)
        : DustWallet(config).startWithSecretKey(
            dustSecretKey,
            ledger.LedgerParameters.initialParameters().dust,
          ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return wallet;
};

export const buildWallet = async (
  profile,
  seed,
  { allowColdSync = false } = {},
) => {
  setNetworkId(profile.networkId);
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    keys[Roles.NightExternal],
    getNetworkId(),
  );

  const cacheable = profile.mode === 'hosted';
  const chainFingerprint = cacheable
    ? await fetchChainFingerprint(profile.endpoints.node)
    : null;
  let snapshot = cacheable ? loadWalletState(profile.networkId, seed) : null;

  if (
    snapshot?.chainFingerprint &&
    chainFingerprint &&
    snapshot.chainFingerprint !== chainFingerprint
  ) {
    deleteWalletState(profile.networkId, seed);
    snapshot = null;
    console.warn(
      `[wallet-cache] ${profile.id} chain changed; discarded its stale snapshot.`,
    );
  }

  if (cacheable && !snapshot && !allowColdSync) {
    throw new Error(
      `No cached wallet state for ${profile.id}. A public-network cold sync can take a long time. ` +
        `Re-run once with --allow-cold-sync to create ${walletCacheDescription(profile.networkId, seed)}.`,
    );
  }

  let wallet;
  let restoredFromCache = false;
  try {
    wallet = await startFacade(
      profile,
      shieldedSecretKeys,
      dustSecretKey,
      unshieldedKeystore,
      snapshot,
    );
    restoredFromCache = snapshot !== null;
  } catch (error) {
    if (!snapshot) throw error;
    deleteWalletState(profile.networkId, seed);
    if (!allowColdSync) {
      throw new Error(
        `The cached ${profile.id} wallet state could not be restored. Re-run with --allow-cold-sync to rebuild it.`,
        { cause: error },
      );
    }
    console.warn(
      `[wallet-cache] ${profile.id} restore failed; rebuilding from chain history.`,
    );
    wallet = await startFacade(
      profile,
      shieldedSecretKeys,
      dustSecretKey,
      unshieldedKeystore,
      null,
    );
  }

  let cacheDisabled = false;
  const persistState = async () => {
    if (!cacheable || cacheDisabled) return;
    saveWalletState(profile.networkId, seed, {
      shielded: await wallet.shielded.serializeState(),
      unshielded: await wallet.unshielded.serializeState(),
      dust: await wallet.dust.serializeState(),
      ...(chainFingerprint ? { chainFingerprint } : {}),
    });
  };

  const invalidateCache = () => {
    cacheDisabled = true;
    deleteWalletState(profile.networkId, seed);
  };

  const checkpointWhileSyncing = (intervalMs = 30_000) => {
    if (!cacheable) return async () => {};
    let writing = false;
    const timer = setInterval(() => {
      if (writing) return;
      writing = true;
      void persistState()
        .catch(() => undefined)
        .finally(() => {
          writing = false;
        });
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await persistState().catch(() => undefined);
    };
  };

  return {
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    restoredFromCache,
    persistState,
    invalidateCache,
    checkpointWhileSyncing,
  };
};

const registerForDustGeneration = async (context, timeoutMs) => {
  const state = await firstSyncedState(context.wallet, timeoutMs);
  if (state.dust.balance(new Date()) > 0n) return;

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await waitForState(
      context.wallet,
      (next) => next.isSynced && next.dust.balance(new Date()) > 0n,
      timeoutMs,
      'DUST from already-registered NIGHT',
    );
    return;
  }

  console.log('[wallet] registering NIGHT for DUST generation');
  const recipe = await context.wallet.registerNightUtxosForDustGeneration(
    nightUtxos,
    context.unshieldedKeystore.getPublicKey(),
    (payload) => context.unshieldedKeystore.signData(payload),
  );
  const finalized = await context.wallet.finalizeRecipe(recipe);
  await context.wallet.submitTransaction(finalized);
  await waitForState(
    context.wallet,
    (next) => next.isSynced && next.dust.balance(new Date()) > 0n,
    timeoutMs,
    'DUST generation',
  );
};

export const awaitWalletReady = async (
  context,
  { operationTimeoutMs = 10 * 60_000 } = {},
) => {
  const syncTimeoutMs = context.restoredFromCache
    ? DEFAULT_RESTORED_SYNC_TIMEOUT_MS
    : undefined;
  try {
    const state = await firstSyncedState(context.wallet, syncTimeoutMs);
    await context.persistState().catch((error) =>
      console.warn(`[wallet-cache] checkpoint failed: ${error.message}`),
    );
    const night = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (night <= 0n) {
      throw new Error(
        `Wallet ${context.unshieldedKeystore.getBech32Address().asString()} has no NIGHT. Fund it from the profile faucet, then rerun.`,
      );
    }
    await registerForDustGeneration(context, operationTimeoutMs);
    return await firstSyncedState(context.wallet, operationTimeoutMs);
  } catch (error) {
    if (
      context.restoredFromCache &&
      /wallet sync/.test(error instanceof Error ? error.message : String(error))
    ) {
      context.invalidateCache();
      console.warn(
        '[wallet-cache] restored wallet did not sync; the snapshot was invalidated.',
      );
    }
    throw error;
  }
};

export const startSyncHeartbeat = (wallet, label, intervalMs = 30_000) => {
  let latest = null;
  const subscription = wallet.state().subscribe({ next: (state) => (latest = state) });
  const timer = setInterval(() => {
    if (!latest) {
      console.log(`[wallet ${label}] waiting for first sync state`);
      return;
    }
    const parts = ['shielded', 'unshielded', 'dust'].map((name) => {
      const progress = latest[name]?.progress ?? {};
      const applied = progress.appliedIndex ?? progress.appliedId ?? '?';
      const highest = progress.highestIndex ?? progress.highestTransactionId ?? '?';
      return `${name}=${applied}/${highest}`;
    });
    console.log(
      `[wallet ${label}] synced=${latest.isSynced} ${parts.join(' ')}`,
    );
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    subscription.unsubscribe();
  };
};
