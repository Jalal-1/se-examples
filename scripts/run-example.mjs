import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const lineToToolchain = { 'v1-stable': 'v1', 'v2-rc': 'v2' };

const usage = () => {
  console.log(`Usage: npm run e2e -- --example <id> --profile <network> [--allow-cold-sync]

The profile selects the isolated v1 or v2 toolchain automatically. An example
is excluded only when the profile lacks one of its declared capabilities.`);
};

const parseArguments = (arguments_) => {
  let exampleId;
  let profileId;
  let allowColdSync = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--allow-cold-sync') {
      allowColdSync = true;
      continue;
    }
    if (argument === '--example' || argument === '--profile') {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === '--example') exampleId = value;
      else profileId = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--example=')) {
      exampleId = argument.slice('--example='.length);
      continue;
    }
    if (argument.startsWith('--profile=')) {
      profileId = argument.slice('--profile='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!exampleId) throw new Error('Missing required --example argument.');
  if (!profileId) throw new Error('Missing required --profile argument.');
  return { exampleId, profileId, allowColdSync, help: false };
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const examplesRoot = path.join(repoRoot, 'examples');
  const exampleEntry = readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: entry.name,
      file: path.join(examplesRoot, entry.name, 'example.json'),
    }))
    .filter(({ file }) => existsSync(file))
    .map((entry) => ({ ...entry, manifest: readJson(entry.file) }))
    .find(
      ({ directory, manifest }) =>
        directory === options.exampleId || manifest.id === options.exampleId,
    );
  const profileFile = path.join(
    repoRoot,
    'network-profiles',
    options.profileId,
    'network.json',
  );
  if (!exampleEntry) throw new Error(`Unknown example: ${options.exampleId}`);
  if (!existsSync(profileFile)) throw new Error(`Unknown profile: ${options.profileId}`);

  const example = exampleEntry.manifest;
  const profile = readJson(profileFile);
  if (profile.status !== 'active') {
    throw new Error(`${profile.id} is not active (status=${profile.status}).`);
  }
  const missing = example.requires.filter(
    (capability) => !profile.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    throw new Error(
      `${example.id} cannot run on ${profile.id}; missing capabilities: ${missing.join(', ')}`,
    );
  }
  if (!example.toolchains[profile.compatibilityLine]) {
    throw new Error(
      `${example.id} is missing its required ${profile.compatibilityLine} implementation.`,
    );
  }

  const toolchain = lineToToolchain[profile.compatibilityLine];
  if (!toolchain) {
    throw new Error(
      `${profile.id} uses unsupported compatibility line ${profile.compatibilityLine}.`,
    );
  }
  const runner = path.join(
    repoRoot,
    'toolchains',
    toolchain,
    'runners',
    `${example.id}.mjs`,
  );
  if (!existsSync(runner)) {
    throw new Error(`${example.id} has no ${profile.compatibilityLine} network runner.`);
  }

  run('npm', [`run`, `compile:${toolchain}`]);
  const runnerArguments = [runner, '--profile', profile.id];
  if (options.allowColdSync) runnerArguments.push('--allow-cold-sync');
  run(process.execPath, runnerArguments);
};

try {
  main();
} catch (error) {
  console.error(`[e2e] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
