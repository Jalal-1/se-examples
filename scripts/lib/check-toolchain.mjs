import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const activeProfiles = () =>
  readdirSync(path.join(repoRoot, 'network-profiles'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(`network-profiles/${entry.name}/network.json`))
    .filter((profile) => profile.status === 'active');

const examples = () =>
  readdirSync(path.join(repoRoot, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: entry.name,
      manifest: readJson(`examples/${entry.name}/example.json`),
    }));

const validateExampleCoverage = (allProfiles, allExamples) => {
  const ids = new Set();
  const coverage = new Map();
  const knownCapabilities = new Set(
    Object.keys(readJson('network-profiles/capabilities.json').capabilities),
  );

  for (const profile of allProfiles) {
    for (const capability of profile.capabilities) {
      assert(
        knownCapabilities.has(capability),
        `${profile.id} declares unknown capability: ${capability}`,
      );
    }
  }

  for (const { directory, manifest } of allExamples) {
    assert(manifest.schemaVersion === 2, `${directory} must use manifest schema 2`);
    assert(!ids.has(manifest.id), `duplicate example id: ${manifest.id}`);
    ids.add(manifest.id);
    assert(Array.isArray(manifest.requires), `${manifest.id} has no capability requirements`);
    for (const capability of manifest.requires) {
      assert(
        knownCapabilities.has(capability),
        `${manifest.id} requires unknown capability: ${capability}`,
      );
    }
    assert(
      manifest.toolchains && Object.keys(manifest.toolchains).length > 0,
      `${manifest.id} has no toolchain targets`,
    );

    const eligible = [];
    const excluded = [];
    for (const profile of allProfiles) {
      const missing = manifest.requires.filter(
        (capability) => !profile.capabilities.includes(capability),
      );
      if (missing.length > 0) {
        excluded.push({ profile: profile.id, missing });
        continue;
      }

      const target = manifest.toolchains[profile.compatibilityLine];
      assert(
        target,
        `${manifest.id} supports ${profile.id}'s capabilities but has no ${profile.compatibilityLine} implementation`,
      );
      assert(
        typeof target.source === 'string' &&
          existsSync(path.join(repoRoot, 'examples', directory, target.source)),
        `${manifest.id}/${profile.compatibilityLine} source is missing: ${target.source}`,
      );
      assert(
        target.openzeppelin?.package ===
          profile.components.openzeppelinCompact?.package &&
          target.openzeppelin?.version ===
            profile.components.openzeppelinCompact?.version,
        `${manifest.id}/${profile.id} OpenZeppelin pin does not match the profile`,
      );
      eligible.push(profile.id);
    }

    assert(eligible.length > 0, `${manifest.id} is not runnable on any active profile`);
    coverage.set(manifest.id, { eligible, excluded });
  }
  return coverage;
};

export const checkToolchain = ({
  compatibilityLine,
  profileId,
  toolchainDirectory,
  requiredPins,
  forbiddenPackages,
}) => {
  const profile = readJson(`network-profiles/${profileId}/network.json`);
  const manifest = readJson(`toolchains/${toolchainDirectory}/package.json`);
  const lockfile = readJson(`toolchains/${toolchainDirectory}/package-lock.json`);

  assert(
    profile.compatibilityLine === compatibilityLine,
    `${profileId} is not a ${compatibilityLine} profile`,
  );
  assert(manifest.engines?.node === '>=22', `${compatibilityLine} requires Node.js >=22`);
  assert(lockfile.lockfileVersion === 3, `${compatibilityLine} requires npm lockfileVersion 3`);

  const rootLock = lockfile.packages?.[''];
  assert(rootLock, `${compatibilityLine} lockfile is missing its root package`);
  const allowedDirectPackages = new Set(
    requiredPins.map(([, component]) => profile.components[component].package),
  );
  const declaredDirectPackages = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });
  assert(
    declaredDirectPackages.length === allowedDirectPackages.size &&
      declaredDirectPackages.every((packageName) =>
        allowedDirectPackages.has(packageName),
      ),
    `${compatibilityLine} contains a direct dependency not declared by ${profileId}`,
  );

  for (const [section, componentName] of requiredPins) {
    const component = profile.components[componentName];
    assert(component?.package, `${profileId}.${componentName} has no npm package`);
    const packageName = component.package;
    const version = component.version;
    assert(
      manifest[section]?.[packageName] === version,
      `${packageName} must be pinned exactly to ${version}`,
    );
    assert(
      rootLock[section]?.[packageName] === version,
      `${packageName} lockfile pin is not ${version}`,
    );
    const installedCopies = Object.entries(lockfile.packages).filter(
      ([lockPath]) =>
        lockPath === `node_modules/${packageName}` ||
        lockPath.endsWith(`/node_modules/${packageName}`),
    );
    assert(installedCopies.length > 0, `${packageName} is missing from the lockfile`);
    for (const [lockPath, metadata] of installedCopies) {
      assert(
        metadata.version === version,
        `${lockPath} resolved ${metadata.version}; expected ${version}`,
      );
    }
  }

  for (const [packageName, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    assert(
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version),
      `${packageName} is not an exact version`,
    );
  }

  for (const lockPath of Object.keys(lockfile.packages)) {
    for (const packageName of forbiddenPackages) {
      assert(
        !lockPath.endsWith(`node_modules/${packageName}`),
        `${compatibilityLine} lockfile contains forbidden ${packageName}`,
      );
    }
  }

  const profiles = activeProfiles();
  const allExamples = examples();
  const coverage = validateExampleCoverage(profiles, allExamples);
  const lineProfiles = profiles.filter(
    (candidate) => candidate.compatibilityLine === compatibilityLine,
  );
  for (const candidate of lineProfiles) {
    for (const [, componentName] of requiredPins) {
      const expected = profile.components[componentName];
      const actual = candidate.components[componentName];
      assert(
        actual?.package === expected.package && actual?.version === expected.version,
        `${candidate.id}.${componentName} does not match ${profileId}`,
      );
    }
  }

  const runnableExamples = allExamples.filter(({ manifest: example }) =>
    coverage
      .get(example.id)
      .eligible.some((targetId) =>
        lineProfiles.some((profileTarget) => profileTarget.id === targetId),
      ),
  );
  assert(
    runnableExamples.length > 0,
    `${compatibilityLine} has no runnable examples`,
  );

  console.log(
    `${compatibilityLine} verified: ${requiredPins.length} exact pins, ` +
      `${lineProfiles.length} active profile(s), ${runnableExamples.length} example(s), ` +
      'capability coverage complete',
  );
};
