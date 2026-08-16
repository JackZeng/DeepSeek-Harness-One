import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { commandExists, parseCommand } from '../runtime/process-utils.mjs';
import { pathExists, readJson, redactSecrets } from '../core/utils.mjs';

export class ExtensionService {
  constructor({ config, registryFile }) {
    this.config = config;
    this.registryFile = registryFile;
    this.registry = [];
  }

  async init() {
    this.registry = JSON.parse(await readFile(this.registryFile, 'utf8'));
  }

  async list() {
    const installedPackages = await this.#installedPackages();
    const dshAvailable = await commandExists(parseCommand(this.config.dshCommand)[0]);
    return this.registry.map((extension) => ({
      ...extension,
      status: extension.id === 'deepseek-harness'
        ? (dshAvailable ? 'installed' : 'missing')
        : installedPackages.has(packageIdentifier(extension))
          ? 'installed'
          : 'available',
      canInstall: this.config.allowExtensionInstall && extension.install.kind === 'dsh-plugin' && dshAvailable,
    }));
  }

  get(id) {
    return this.registry.find((extension) => extension.id === id) ?? null;
  }

  async plan(id) {
    const extension = this.get(id);
    if (!extension) throw new Error('Extension not found.');
    if (extension.install.kind === 'dsh-plugin') {
      const command = `${this.config.dshCommand} plugin --profile ${extension.install.profile} add ${extension.install.source}`;
      return { extensionId: id, commands: [command], automatic: this.config.allowExtensionInstall };
    }
    return { extensionId: id, commands: extension.install.commands ?? [], automatic: false };
  }

  async install(id, onLog = () => {}) {
    const extension = this.get(id);
    if (!extension) throw new Error('Extension not found.');
    if (!this.config.allowExtensionInstall) throw new Error('Automatic extension installation is disabled.');
    if (extension.install.kind !== 'dsh-plugin') throw new Error('This extension requires guided installation.');

    const base = parseCommand(this.config.dshCommand);
    const args = [
      ...base.slice(1),
      'plugin',
      '--profile',
      extension.install.profile,
      'add',
      extension.install.source,
    ];
    const child = spawn(base[0], args, { shell: false, windowsHide: true, env: process.env });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => onLog(redactSecrets(chunk)));
    child.stderr.on('data', (chunk) => onLog(redactSecrets(chunk)));
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode) => resolve(exitCode ?? 1));
    });
    if (code !== 0) throw new Error(`Extension installer exited with code ${code}.`);
    return { installed: true, extensionId: id };
  }

  async #installedPackages() {
    const result = new Set();
    const profilesRoot = path.join(this.config.dshHome, 'profiles');
    if (!(await pathExists(profilesRoot))) return result;
    for (const extension of this.registry) {
      const profile = extension.install?.profile;
      if (!profile) continue;
      const packageFile = path.join(profilesRoot, profile, 'package.json');
      const manifest = await readJson(packageFile, null);
      if (!manifest) continue;
      for (const name of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) })) {
        result.add(name);
      }
    }
    return result;
  }
}

function packageIdentifier(extension) {
  if (extension.install?.kind !== 'dsh-plugin') return extension.id;
  const source = extension.install.source;
  if (source.startsWith('github:')) return source.slice(7).split('#')[0];
  return source.replace(/@\d.*$/, '');
}
