import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const examplesRoot = path.join(repoRoot, 'examples');
const toolchainRoot = path.join(repoRoot, 'toolchains', 'v1');
const skipZk = process.argv.includes('--skip-zk');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const profile = readJson(
  path.join(repoRoot, 'network-profiles', 'local-v1', 'network.json'),
);
const compilerVersion = profile.components.compactCompiler.version;

const versionCheck = spawnSync(
  'compact',
  ['compile', `+${compilerVersion}`, '--version'],
  { cwd: repoRoot, encoding: 'utf8' },
);

if (versionCheck.status !== 0) {
  const detail = [versionCheck.error?.message, versionCheck.stderr?.trim()]
    .filter(Boolean)
    .join('\n');
  throw new Error(
    `Compact compiler ${compilerVersion} is unavailable. Install it with ` +
      `\`compact update --no-set-default ${compilerVersion}\`.` +
      (detail ? `\n${detail}` : ''),
  );
}

if (versionCheck.stdout.trim() !== compilerVersion) {
  throw new Error(
    `Compact selected ${versionCheck.stdout.trim()}; expected ${compilerVersion}`,
  );
}

const manifests = readdirSync(examplesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    directory: entry.name,
    manifest: readJson(path.join(examplesRoot, entry.name, 'example.json')),
  }))
  .filter(({ manifest }) => manifest.toolchainLine === 'v1-stable');

if (manifests.length === 0) {
  throw new Error('No v1-stable examples were found.');
}

for (const { directory, manifest } of manifests) {
  const source = path.join(
    examplesRoot,
    directory,
    'contract',
    `${manifest.id}.compact`,
  );
  const output = path.join(toolchainRoot, 'artifacts', manifest.id);

  if (!existsSync(source)) {
    throw new Error(`${manifest.id}: missing contract source ${source}`);
  }

  rmSync(output, { force: true, recursive: true });

  const args = ['compile', `+${compilerVersion}`];
  if (skipZk) args.push('--skip-zk');
  args.push(
    '--compact-path',
    path.join(toolchainRoot, 'node_modules'),
    source,
    output,
  );

  console.log(
    `${manifest.id}: compiling with Compact ${compilerVersion}` +
      (skipZk ? ' (proving keys skipped)' : ''),
  );
  const compiled = spawnSync('compact', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (compiled.status !== 0) {
    process.exit(compiled.status ?? 1);
  }
}

console.log(`Compiled ${manifests.length} v1 example(s).`);
