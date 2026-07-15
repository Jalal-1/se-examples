import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(`${repoRoot}/${path}`, 'utf8'));
const fail = (message) => {
  throw new Error(message);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const profile = readJson('network-profiles/local-v1/network.json');
const manifest = readJson('toolchains/v1/package.json');
const lockfile = readJson('toolchains/v1/package-lock.json');

assert(profile.compatibilityLine === 'v1-stable', 'local-v1 is not a v1-stable profile');
assert(profile.runtime.specVersion === 1000000, 'local-v1 runtime is not v1');
assert(manifest.engines?.node === '>=22', 'v1 workspace must require Node.js >=22');
assert(lockfile.lockfileVersion === 3, 'v1 workspace requires npm lockfileVersion 3');

const requiredPins = [
  ['dependencies', 'compactJs'],
  ['dependencies', 'compactRuntime'],
  ['dependencies', 'ledger'],
  ['dependencies', 'midnightJs'],
  ['dependencies', 'walletSdk'],
  ['dependencies', 'openzeppelinCompact'],
  ['devDependencies', 'testkitJs'],
];

const rootLock = lockfile.packages?.[''];
assert(rootLock, 'v1 lockfile is missing its root package');
const allowedDirectPackages = new Set(
  requiredPins.map(([, componentName]) => profile.components[componentName].package),
);
const declaredDirectPackages = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
});
assert(
  declaredDirectPackages.length === allowedDirectPackages.size &&
    declaredDirectPackages.every((packageName) => allowedDirectPackages.has(packageName)),
  'v1 workspace contains a direct dependency that is not declared by the local-v1 profile',
);

for (const [section, componentName] of requiredPins) {
  const component = profile.components[componentName];
  assert(component?.package, `profile component ${componentName} has no npm package`);
  const { package: packageName, version } = component;
  const declared = manifest[section]?.[packageName];
  assert(declared === version, `${packageName} must be pinned exactly to ${version}`);
  assert(rootLock[section]?.[packageName] === version, `${packageName} lockfile pin is not ${version}`);

  const installedCopies = Object.entries(lockfile.packages)
    .filter(([path]) => path === `node_modules/${packageName}` || path.endsWith(`/node_modules/${packageName}`));
  assert(installedCopies.length > 0, `${packageName} is missing from the v1 lockfile`);
  for (const [path, metadata] of installedCopies) {
    assert(metadata.version === version, `${path} resolved ${metadata.version}; expected ${version}`);
  }
}

const allDirectPins = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
};
for (const [packageName, version] of Object.entries(allDirectPins)) {
  assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version), `${packageName} is not an exact version`);
}

const forbiddenV2Packages = [
  '@midnightntwrk/ledger-v9',
  '@midnight-ntwrk/ledger-v9',
  '@midnight-ntwrk/zkir-v3',
];
for (const path of Object.keys(lockfile.packages)) {
  for (const packageName of forbiddenV2Packages) {
    assert(!path.endsWith(`node_modules/${packageName}`), `v2 package found in v1 lockfile: ${packageName}`);
  }
}

console.log(`v1 toolchain verified: ${requiredPins.length} profile pins, npm lockfile v3, no v2 packages`);
