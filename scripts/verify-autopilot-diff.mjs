import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containsCredentialMaterial,
  parseNumstat,
  validateAddedContent,
  validateAutopilotDiff,
} from '../src/ecosystem/autopilot-policy.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, 'config/ecosystem-autopilot.json'), 'utf8'));
const workingTree = process.argv.includes('--working-tree');
const base = process.argv.slice(2).find((value) => !value.startsWith('--')) || 'origin/main';
const diffArgs = workingTree ? ['diff', '--numstat', '--find-renames', 'HEAD'] : ['diff', '--numstat', '--find-renames', `${base}...HEAD`];
const textArgs = workingTree ? ['diff', '--no-ext-diff', 'HEAD'] : ['diff', '--no-ext-diff', `${base}...HEAD`];
const numstat = parseNumstat((await run('git', diffArgs)).stdout);
const housekeeping = new Set(config.housekeepingPaths || []);
const productEntries = numstat.filter((entry) => !housekeeping.has(entry.path));
const allPathsGate = validateAutopilotDiff(
  numstat.map((entry) => ({ ...entry, additions: 0, deletions: 0 })),
  {
    ...config,
    maxPatchFiles: Number.MAX_SAFE_INTEGER,
    maxPatchAdditions: Number.MAX_SAFE_INTEGER,
    maxPatchDeletions: Number.MAX_SAFE_INTEGER,
    requireTestsForCode: false,
  },
);
if (!allPathsGate.ok) throw new Error(`Autopilot path policy failed:\n- ${allPathsGate.errors.join('\n- ')}`);
const gate = validateAutopilotDiff(productEntries, config);
if (!gate.ok) throw new Error(`Autopilot diff policy failed:\n- ${gate.errors.join('\n- ')}`);

const diff = (await run('git', textArgs)).stdout;
if (containsCredentialMaterial(diff)) throw new Error('Autopilot diff contains credential-shaped material.');
if (/^Submodule /m.test(diff) || /\.gitmodules/.test(diff)) throw new Error('Autopilot may not introduce submodules.');
if (/^GIT binary patch$/m.test(diff) || /^Binary files /m.test(diff)) throw new Error('Autopilot may not introduce binary patches.');
if (/^(?:new|old) file mode 120000$/m.test(diff)) throw new Error('Autopilot may not introduce symlinks.');
if (/^\+.*(?:npm install|pnpm add|yarn add)\b/m.test(diff)) throw new Error('Autopilot may not introduce dependency installation instructions into product code.');
const contentGate = validateAddedContent(diff);
if (!contentGate.ok) throw new Error(`Autopilot content policy failed:\n- ${contentGate.errors.join('\n- ')}`);

console.log(`Autopilot diff accepted: ${gate.files.length} files, +${gate.additions}/-${gate.deletions}.`);

async function run(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr}`)));
  });
}
