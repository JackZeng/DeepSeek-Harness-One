import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { commandExists, parseCommand } from './runtime/process-utils.mjs';
import { pathExists } from './core/utils.mjs';

export async function runDoctor(config) {
  const checks = [];
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push(result('node-version', major >= 22, `Node.js ${process.versions.node}`, 'Node.js 22 or newer is required.'));

  try {
    await mkdir(config.dataDir, { recursive: true });
    const probe = path.join(config.dataDir, `.doctor-${process.pid}`);
    await writeFile(probe, 'ok', 'utf8');
    await access(probe);
    await unlink(probe);
    checks.push(result('data-directory', true, config.dataDir));
  } catch (error) {
    checks.push(result('data-directory', false, error.message, 'Choose a writable DSH_ONE_DATA_DIR.'));
  }

  const command = parseCommand(config.dshCommand)[0];
  const dshAvailable = await commandExists(command);
  checks.push(result(
    'deepseek-harness',
    dshAvailable,
    dshAvailable ? `Found ${command}` : `Command not found: ${command}`,
    'Use `npx -y @deepseek-ai/dsh web` or install the dsh CLI, then set DSH_ONE_DSH_COMMAND.',
    true,
  ));

  checks.push(result(
    'dsh-home',
    await pathExists(config.dshHome),
    config.dshHome,
    'The official DSH profile directory will be created on first use.',
    true,
  ));
  checks.push(result(
    'listen-address',
    ['127.0.0.1', '::1', 'localhost'].includes(config.host),
    config.host,
    'Keep the default loopback address unless an authenticated reverse proxy protects the service.',
    false,
  ));

  return {
    ok: checks.filter((check) => !check.optional).every((check) => check.passed),
    checks,
  };
}

function result(id, passed, detail, remediation = null, optional = false) {
  return { id, passed, detail, remediation, optional };
}
