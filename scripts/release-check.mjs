import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'openclaw.plugin.json');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const failures = [];

if (pkg.version !== manifest.version) {
  failures.push(`version mismatch: package.json=${pkg.version} openclaw.plugin.json=${manifest.version}`);
}

if (!pkg.repository?.url) {
  failures.push('missing repository.url in package.json');
}

if (!pkg.name?.startsWith('@lxsdsd/')) {
  failures.push(`package name should be scoped, got ${pkg.name || '<missing>'}`);
}

if (typeof pkg.devDependencies?.openclaw === 'string' && pkg.devDependencies.openclaw.startsWith('file:')) {
  failures.push(`devDependencies.openclaw must not use a machine-local file: path (${pkg.devDependencies.openclaw})`);
}

if (manifest.id !== 'sift') {
  failures.push(`plugin id drifted from expected value 'sift': ${manifest.id}`);
}

if (failures.length > 0) {
  console.error('release-check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`release-check ok: ${pkg.name}@${pkg.version} / plugin ${manifest.id}@${manifest.version}`);
