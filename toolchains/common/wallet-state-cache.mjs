import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const cacheRoot = () =>
  path.resolve(
    process.env.SE_WALLET_CACHE_DIR ??
      path.join(repoRoot, '.cache', 'wallet-state'),
  );

const safeNetworkId = (networkId) => networkId.replace(/[^a-z0-9_-]/gi, '_');
const seedFingerprint = (seed) =>
  createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 16);

const cacheFiles = (networkId, seed) => {
  const safeNetwork = safeNetworkId(networkId);
  return [
    path.join(cacheRoot(), `${safeNetwork}-${seedFingerprint(seed)}.wstate.gz`),
    path.join(
      cacheRoot(),
      `${safeNetwork}-${seed.slice(0, 8)}-${seed.slice(-8)}.wstate.gz`,
    ),
  ];
};

const isSnapshot = (value) =>
  typeof value === 'object' &&
  value !== null &&
  typeof value.shielded === 'string' &&
  typeof value.unshielded === 'string' &&
  typeof value.dust === 'string' &&
  (value.chainFingerprint === undefined ||
    typeof value.chainFingerprint === 'string');

export const walletCacheDescription = (networkId, seed) =>
  cacheFiles(networkId, seed)[0];

export const loadWalletState = (networkId, seed) => {
  for (const file of cacheFiles(networkId, seed)) {
    try {
      if (!existsSync(file)) continue;
      const value = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
      if (isSnapshot(value)) return value;
    } catch {
      // A malformed snapshot is a cache miss. The caller decides whether a
      // cold sync is permitted.
    }
  }
  return null;
};

export const saveWalletState = (networkId, seed, snapshot) => {
  const [file] = cacheFiles(networkId, seed);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const compressed = gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
  writeFileSync(temporary, compressed, { mode: 0o600 });
  renameSync(temporary, file);
};

export const deleteWalletState = (networkId, seed) => {
  for (const file of cacheFiles(networkId, seed)) {
    rmSync(file, { force: true });
  }
};
