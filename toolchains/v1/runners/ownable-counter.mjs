import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';

import {
  Contract,
  ledger as readLedger,
} from '../artifacts/ownable-counter/contract/index.js';
import { configureProviders } from '../network/providers.mjs';
import {
  awaitWalletReady,
  buildWallet,
  LOCAL_GENESIS_SEED,
  startSyncHeartbeat,
} from '../network/wallet.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const privateStateId = 'ownableCounterPrivateState';
const supportedProfiles = new Set(['local-v1', 'preview', 'preprod']);
const zeroBytes = new Uint8Array(32);
const secretKeyType = new CompactTypeVector(1, new CompactTypeBytes(32));

const usage = () => {
  console.log(`Usage: npm run e2e:v1 -- --profile <local-v1|preview|preprod> [--allow-cold-sync]

Runs the Ownable Counter against a real node, indexer, prover, and wallet.

Hosted seed variables:
  preview: SE_PREVIEW_SEED
  preprod: SE_PREPROD_SEED

Hosted runs require a cached wallet snapshot by default. Pass
--allow-cold-sync once to create/resume one. Override the cache location with
SE_WALLET_CACHE_DIR.`);
};

const parseArguments = (arguments_) => {
  let profileId;
  let allowColdSync = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--allow-cold-sync') {
      allowColdSync = true;
      continue;
    }
    if (argument === '--profile') {
      profileId = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith('--profile=')) {
      profileId = argument.slice('--profile='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!profileId) throw new Error('Missing required --profile argument.');
  return { profileId, allowColdSync, help: false };
};

const readProfile = (profileId) => {
  if (profileId === 'stagenet' || profileId === 'local-v2') {
    throw new Error(
      `${profileId} is a v2 RC lane and cannot use the v1 wallet/runtime. Add the isolated v2 toolchain before running this example there.`,
    );
  }
  if (!supportedProfiles.has(profileId)) {
    throw new Error(`Unsupported v1 profile: ${profileId}`);
  }
  const profileFile = path.join(
    repoRoot,
    'network-profiles',
    profileId,
    'network.json',
  );
  const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  if (
    profile.compatibilityLine !== 'v1-stable' ||
    profile.runtime.specVersion !== 1_000_000 ||
    profile.runtime.transactionVersion !== 3
  ) {
    throw new Error(`${profileId} is not compatible with the pinned v1 runner.`);
  }
  return profile;
};

const seedForProfile = (profile) => {
  if (profile.id === 'local-v1') return LOCAL_GENESIS_SEED;
  const variable = `SE_${profile.id.replaceAll('-', '_').toUpperCase()}_SEED`;
  const seed = process.env[variable];
  if (!seed) {
    throw new Error(
      `${variable} is required. Supply a funded 64-character hex seed through the environment; do not put it on the command line.`,
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error(`${variable} must be exactly 64 hexadecimal characters.`);
  }
  return seed.toLowerCase();
};

const positiveIntegerEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
};

const preflight = (profileId) => {
  const result = spawnSync(
    path.join(repoRoot, 'scripts', 'preflight-network.sh'),
    [profileId, '--proof'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${profileId} compatibility preflight failed.`);
  }
};

const ownerFor = (secretKey) => ({
  is_left: true,
  left: persistentHash(secretKeyType, [secretKey]),
  right: { bytes: zeroBytes },
});

const witnesses = {
  wit_OwnableSK(context) {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.ownerSecret),
    ];
  },
};

const errorText = (error) => {
  const messages = [];
  let current = error;
  while (current && !messages.includes(current.message ?? String(current))) {
    messages.push(current.message ?? String(current));
    current = current.cause;
  }
  return messages.join(' | ');
};

const withTimeout = (promise, timeoutMs, description) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${description} timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

const readCounter = async (providers, contractAddress) => {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress,
  );
  return state === null ? null : readLedger(state.data).counter;
};

const waitForCounter = async (
  providers,
  contractAddress,
  expected,
  timeoutMs,
) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = await readCounter(providers, contractAddress);
      if (last === expected) return last;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Indexer did not report counter=${expected}; last value was ${last}.`,
    { cause: lastError },
  );
};

const expectOwnerRejection = async (
  deployed,
  providers,
  contractAddress,
  unchangedCounter,
  operationTimeoutMs,
) => {
  let rejection;
  try {
    await withTimeout(
      deployed.callTx.increment(),
      operationTimeoutMs,
      'unauthorized increment',
    );
  } catch (error) {
    rejection = error;
  }
  if (!rejection) {
    throw new Error('Unauthorized increment unexpectedly succeeded.');
  }
  if (!/Ownable: caller is not the owner/.test(errorText(rejection))) {
    throw new Error('Unauthorized increment failed for an unexpected reason.', {
      cause: rejection,
    });
  }
  const actual = await readCounter(providers, contractAddress);
  if (actual !== unchangedCounter) {
    throw new Error(
      `Unauthorized increment changed counter from ${unchangedCounter} to ${actual}.`,
    );
  }
};

const run = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const profile = readProfile(options.profileId);
  const seed = seedForProfile(profile);
  const operationTimeoutMs = positiveIntegerEnv(
    'SE_OPERATION_TIMEOUT_MS',
    10 * 60_000,
  );
  const stateTimeoutMs = positiveIntegerEnv(
    'SE_STATE_TIMEOUT_MS',
    5 * 60_000,
  );
  const zkConfigPath = path.join(
    repoRoot,
    'toolchains',
    'v1',
    'artifacts',
    'ownable-counter',
  );
  if (!existsSync(path.join(zkConfigPath, 'keys', 'increment.prover'))) {
    throw new Error('Deployable Ownable Counter artifacts are missing. Run npm run compile:v1.');
  }

  console.log(`[e2e] profile=${profile.id} compatibility=${profile.compatibilityLine}`);
  preflight(profile.id);

  let walletContext;
  let stopCheckpoint = async () => {};
  let stopHeartbeat = () => {};
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    stopHeartbeat();
    await stopCheckpoint();
    if (walletContext) {
      await walletContext.persistState().catch(() => undefined);
      await walletContext.wallet.stop().catch(() => undefined);
    }
  };
  const interrupt = (signal) => {
    console.warn(`[e2e] ${signal}; saving wallet checkpoint before exit`);
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', () => interrupt('SIGINT'));
  process.once('SIGTERM', () => interrupt('SIGTERM'));

  try {
    walletContext = await buildWallet(profile, seed, {
      allowColdSync: options.allowColdSync,
    });
    stopCheckpoint = walletContext.checkpointWhileSyncing();
    stopHeartbeat = startSyncHeartbeat(walletContext.wallet, profile.id);
    console.log(
      `[wallet] ${walletContext.restoredFromCache ? 'restoring cached state' : 'syncing from chain'}`,
    );
    const walletState = await awaitWalletReady(walletContext, {
      operationTimeoutMs,
    });
    stopHeartbeat();
    console.log(
      `[wallet] ready NIGHT=${walletState.unshielded.balances[unshieldedToken().raw] ?? 0n} DUST=${walletState.dust.balance(new Date())}`,
    );

    const providers = await configureProviders(
      walletContext,
      profile,
      zkConfigPath,
    );
    const compiledContract = CompiledContract.make(
      'ownable-counter',
      Contract,
    ).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets(zkConfigPath),
    );

    const ownerSecret = randomBytes(32);
    const strangerSecret = randomBytes(32);
    const newOwnerSecret = randomBytes(32);

    console.log('[e2e] deploying Ownable Counter');
    const deployed = await withTimeout(
      deployContract(providers, {
        compiledContract,
        privateStateId,
        initialPrivateState: { ownerSecret },
        args: [ownerFor(ownerSecret)],
      }),
      operationTimeoutMs,
      'contract deployment',
    );
    const contractAddress = deployed.deployTxData.public.contractAddress;
    console.log(`[e2e] deployed contract=${contractAddress}`);
    await waitForCounter(
      providers,
      contractAddress,
      0n,
      stateTimeoutMs,
    );

    console.log('[e2e] owner increment: expect 0 -> 1');
    await withTimeout(
      deployed.callTx.increment(),
      operationTimeoutMs,
      'owner increment',
    );
    await waitForCounter(
      providers,
      contractAddress,
      1n,
      stateTimeoutMs,
    );

    console.log('[e2e] stranger increment: expect authorization rejection');
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(privateStateId, {
      ownerSecret: strangerSecret,
    });
    await expectOwnerRejection(
      deployed,
      providers,
      contractAddress,
      1n,
      operationTimeoutMs,
    );

    console.log('[e2e] transferring ownership');
    await providers.privateStateProvider.set(privateStateId, { ownerSecret });
    await withTimeout(
      deployed.callTx.transferOwnership(ownerFor(newOwnerSecret)),
      operationTimeoutMs,
      'ownership transfer',
    );

    console.log('[e2e] old owner increment: expect authorization rejection');
    await expectOwnerRejection(
      deployed,
      providers,
      contractAddress,
      1n,
      operationTimeoutMs,
    );

    console.log('[e2e] new owner increment: expect 1 -> 2');
    await providers.privateStateProvider.set(privateStateId, {
      ownerSecret: newOwnerSecret,
    });
    await withTimeout(
      deployed.callTx.increment(),
      operationTimeoutMs,
      'new owner increment',
    );
    await waitForCounter(
      providers,
      contractAddress,
      2n,
      stateTimeoutMs,
    );

    console.log(
      `[e2e] PASS ${profile.id}: deploy, owner authorization, rejection, transfer, final counter=2`,
    );
  } finally {
    await cleanup();
  }
};

run().catch((error) => {
  console.error(`[e2e] FAIL: ${errorText(error)}`);
  process.exitCode = 1;
});
