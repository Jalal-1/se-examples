import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const parseArguments = (arguments_, profiles) => {
  let profileId;
  let allowColdSync = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') {
      console.log(
        `Usage: --profile <${profiles.join('|')}> [--allow-cold-sync]`,
      );
      return { help: true };
    }
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

const readProfile = (profileId, compatibilityLine, supportedProfiles) => {
  if (!supportedProfiles.includes(profileId)) {
    throw new Error(
      `${profileId} is not supported by the ${compatibilityLine} runner.`,
    );
  }
  const profile = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'network-profiles', profileId, 'network.json'),
      'utf8',
    ),
  );
  if (profile.compatibilityLine !== compatibilityLine) {
    throw new Error(
      `${profileId} requires ${profile.compatibilityLine}, not ${compatibilityLine}.`,
    );
  }
  return profile;
};

const seedForProfile = (profile, localGenesisSeed) => {
  if (profile.mode === 'local') return localGenesisSeed;
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

export const errorText = (error) => {
  const messages = [];
  let current = error;
  while (current && !messages.includes(current.message ?? String(current))) {
    messages.push(current.message ?? String(current));
    current = current.cause;
  }
  return messages.join(' | ');
};

export const withTimeout = (promise, timeoutMs, description) => {
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

export const queryContractLedger = async (
  providers,
  contractAddress,
  readLedger,
) => {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress,
  );
  return state === null ? null : readLedger(state.data);
};

export const waitForContractLedger = async ({
  providers,
  contractAddress,
  readLedger,
  predicate,
  timeoutMs,
  description,
}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = await queryContractLedger(
        providers,
        contractAddress,
        readLedger,
      );
      if (state !== null && predicate(state)) return state;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Indexer did not report ${description}.`, { cause: lastError });
};

export const runNetworkExample = async ({
  compatibilityLine,
  toolchainDirectory,
  supportedProfiles,
  artifactId,
  requiredProver,
  ledger,
  configureProviders,
  walletApi,
  execute,
}) => {
  const options = parseArguments(process.argv.slice(2), supportedProfiles);
  if (options.help) return;
  const profile = readProfile(
    options.profileId,
    compatibilityLine,
    supportedProfiles,
  );
  const seed = seedForProfile(profile, walletApi.LOCAL_GENESIS_SEED);
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
    toolchainDirectory,
    'artifacts',
    artifactId,
  );
  if (!existsSync(path.join(zkConfigPath, 'keys', requiredProver))) {
    throw new Error(
      `Deployable ${artifactId} artifacts are missing. Run npm run compile:${toolchainDirectory}.`,
    );
  }

  console.log(`[e2e] profile=${profile.id} compatibility=${compatibilityLine}`);
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
    walletContext = await walletApi.buildWallet(profile, seed, {
      allowColdSync: options.allowColdSync,
    });
    stopCheckpoint = walletContext.checkpointWhileSyncing();
    stopHeartbeat = walletApi.startSyncHeartbeat(walletContext.wallet, profile.id);
    console.log(
      `[wallet] ${walletContext.restoredFromCache ? 'restoring cached state' : 'syncing from chain'}`,
    );
    const walletState = await walletApi.awaitWalletReady(walletContext, {
      operationTimeoutMs,
    });
    stopHeartbeat();
    console.log(
      `[wallet] ready NIGHT=${walletState.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n} DUST=${walletState.dust.balance(new Date())}`,
    );

    const providers = await configureProviders(
      walletContext,
      profile,
      zkConfigPath,
    );
    await execute({
      profile,
      providers,
      zkConfigPath,
      operationTimeoutMs,
      stateTimeoutMs,
    });
  } finally {
    await cleanup();
  }
};
