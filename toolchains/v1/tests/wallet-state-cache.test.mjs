import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  deleteWalletState,
  loadWalletState,
  saveWalletState,
  walletCacheDescription,
} from '../network/wallet-state-cache.mjs';

const networkId = 'preprod';
const seed = 'ab'.repeat(32);
const snapshot = {
  shielded: 'shielded-state',
  unshielded: 'unshielded-state',
  dust: 'dust-state',
  chainFingerprint: 'genesis-hash',
};
let previousCacheDirectory;
let cacheDirectory;

before(() => {
  previousCacheDirectory = process.env.SE_WALLET_CACHE_DIR;
  cacheDirectory = mkdtempSync(path.join(tmpdir(), 'se-wallet-cache-'));
  process.env.SE_WALLET_CACHE_DIR = cacheDirectory;
});

after(() => {
  rmSync(cacheDirectory, { force: true, recursive: true });
  if (previousCacheDirectory === undefined) {
    delete process.env.SE_WALLET_CACHE_DIR;
  } else {
    process.env.SE_WALLET_CACHE_DIR = previousCacheDirectory;
  }
});

test('saves a private hashed checkpoint and restores it', () => {
  saveWalletState(networkId, seed, snapshot);

  const expectedHash = createHash('sha256')
    .update(seed, 'utf8')
    .digest('hex')
    .slice(0, 16);
  const file = walletCacheDescription(networkId, seed);
  assert.equal(path.basename(file), `${networkId}-${expectedHash}.wstate.gz`);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadWalletState(networkId, seed), snapshot);
  assert.ok(readFileSync(file).length > 0);
});

test('loads the legacy midnight-canary checkpoint name', () => {
  deleteWalletState(networkId, seed);
  const legacy = path.join(
    cacheDirectory,
    `${networkId}-${seed.slice(0, 8)}-${seed.slice(-8)}.wstate.gz`,
  );
  writeFileSync(legacy, gzipSync(Buffer.from(JSON.stringify(snapshot))), {
    mode: 0o600,
  });

  assert.deepEqual(loadWalletState(networkId, seed), snapshot);
  deleteWalletState(networkId, seed);
  assert.equal(loadWalletState(networkId, seed), null);
});

test('treats a corrupt checkpoint as a cache miss', () => {
  const file = walletCacheDescription(networkId, seed);
  writeFileSync(file, 'not-gzip');
  chmodSync(file, 0o600);

  assert.equal(loadWalletState(networkId, seed), null);
});
