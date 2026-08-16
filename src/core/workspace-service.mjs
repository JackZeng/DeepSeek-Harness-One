import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createId, ensureDir, ISO_NOW, isDirectory, readJson, sortByDateDescending, writeJsonAtomic } from './utils.mjs';

export class WorkspaceService {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state', 'workspaces.json');
    this.workspaces = [];
  }

  async init() {
    this.workspaces = await readJson(this.file, []);
    await this.#ensureDemoWorkspace();
    await this.#persist();
  }

  list() {
    return sortByDateDescending(this.workspaces);
  }

  get(id) {
    return this.workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  async add({ name, directory }) {
    if (!directory || !(await isDirectory(directory))) {
      throw new TypeError('Workspace directory must be an existing directory.');
    }
    const canonical = await realpath(directory);
    const existing = this.workspaces.find((workspace) => workspace.path === canonical);
    if (existing) return existing;

    const timestamp = ISO_NOW();
    const workspace = {
      id: createId('ws'),
      name: String(name || path.basename(canonical) || 'Workspace').slice(0, 100),
      path: canonical,
      kind: 'local',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    this.workspaces.push(workspace);
    await this.#persist();
    return workspace;
  }

  async touch(id) {
    const workspace = this.get(id);
    if (!workspace) throw new Error('Workspace not found.');
    workspace.updatedAt = ISO_NOW();
    workspace.lastOpenedAt = workspace.updatedAt;
    await this.#persist();
    return workspace;
  }

  async remove(id) {
    const workspace = this.get(id);
    if (!workspace) return false;
    if (workspace.kind === 'demo') throw new Error('The demo workspace cannot be removed.');
    this.workspaces = this.workspaces.filter((item) => item.id !== id);
    await this.#persist();
    return true;
  }

  async #ensureDemoWorkspace() {
    const directory = path.join(this.dataDir, 'demo-workspace');
    await mkdir(directory, { recursive: true });
    const readme = path.join(directory, 'README.md');
    try {
      await writeFile(
        readme,
        '# DeepSeek Harness One Demo Workspace\n\nThis workspace is safe to use while exploring the product.\n',
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const canonical = await realpath(directory);
    if (!this.workspaces.some((workspace) => workspace.kind === 'demo')) {
      const timestamp = ISO_NOW();
      this.workspaces.unshift({
        id: 'ws_demo',
        name: 'Demo Workspace',
        path: canonical,
        kind: 'demo',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
      });
    }
  }

  async #persist() {
    await ensureDir(path.dirname(this.file));
    await writeJsonAtomic(this.file, this.workspaces);
  }
}
