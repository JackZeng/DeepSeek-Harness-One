import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoots = ['bin', 'src', 'scripts', 'tests', 'public'];
const javascript = [];
const jsonFiles = [
  'package.json',
  'config/integrations.json',
  'config/ecosystem-autopilot.json',
  'config/ecosystem-autopilot-state.json',
  'public/manifest.webmanifest',
];

for (const directory of sourceRoots) await collect(path.join(root, directory));
for (const file of javascript) await runNodeCheck(file);
for (const relative of jsonFiles) JSON.parse(await readFile(path.join(root, relative), 'utf8'));

const registry = JSON.parse(await readFile(path.join(root, 'config/integrations.json'), 'utf8'));
const ids = registry.map((item) => item.id);
if (new Set(ids).size !== ids.length) throw new Error('Integration registry contains duplicate IDs.');
if (!registry.every((item) => item.name && item.description && item.license && item.install)) {
  throw new Error('Every integration must include name, description, license and install metadata.');
}

console.log(`Checked ${javascript.length} JavaScript modules and ${jsonFiles.length} JSON documents.`);

async function collect(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (/\.(?:mjs|js)$/.test(entry.name)) javascript.push(target);
  }
}

async function runNodeCheck(file) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`Syntax check failed: ${path.relative(root, file)}`);
}
