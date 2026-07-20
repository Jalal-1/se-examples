import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const examplesRoot = path.join(repoRoot, 'examples');
const toolchainRoot = path.join(repoRoot, 'toolchains', 'v2');
const skipZk = process.argv.includes('--skip-zk');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const profile = readJson(
  path.join(repoRoot, 'network-profiles', 'local-v2', 'network.json'),
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
    `Compact compiler ${compilerVersion} is unavailable. Install the release artifact named by the local-v2 profile.` +
      (detail ? `\n${detail}` : ''),
  );
}
const reportedVersion = versionCheck.stdout.trim();
const releaseBaseVersion = compilerVersion.replace(/-rc\..*$/, '');
if (
  reportedVersion !== compilerVersion &&
  reportedVersion !== releaseBaseVersion
) {
  throw new Error(
    `Compact selected ${reportedVersion}; expected ${compilerVersion} (${releaseBaseVersion} binary).`,
  );
}

const manifests = readdirSync(examplesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    directory: entry.name,
    manifest: readJson(path.join(examplesRoot, entry.name, 'example.json')),
  }))
  .map((entry) => ({
    ...entry,
    target: entry.manifest.toolchains?.['v2-rc'],
  }))
  .filter(({ target }) => target !== undefined);

if (manifests.length === 0) {
  throw new Error('No v2-rc examples were found.');
}

for (const { directory, manifest, target } of manifests) {
  const source = path.join(examplesRoot, directory, target.source);
  const output = path.join(toolchainRoot, 'artifacts', manifest.id);
  if (!existsSync(source)) {
    throw new Error(`${manifest.id}: missing contract source ${source}`);
  }
  rmSync(output, { force: true, recursive: true });

  const args = ['compile', `+${compilerVersion}`];
  if (skipZk) args.push('--skip-zk');
  args.push(
    '--feature-zkir-v3',
    '--compact-path',
    path.join(toolchainRoot, 'node_modules'),
    source,
    output,
  );

  console.log(
    `${manifest.id}: compiling with Compact ${compilerVersion} and ZKIR v3` +
      (skipZk ? ' (proving keys skipped)' : ''),
  );
  const compiled = spawnSync('compact', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (compiled.status !== 0) process.exit(compiled.status ?? 1);
}

console.log(`Compiled ${manifests.length} v2 example(s).`);
