import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createId, ensureDir, isPathInside, safeFilename } from './utils.mjs';

export class ArtifactService {
  constructor({ dataDir }) {
    this.root = path.join(dataDir, 'artifacts');
  }

  async init() {
    await ensureDir(this.root);
  }

  async createText(taskId, { name, content, mediaType = 'text/markdown', kind = 'document' }) {
    const directory = path.join(this.root, taskId);
    await ensureDir(directory);
    const filename = safeFilename(name, 'artifact.md');
    const file = path.join(directory, filename);
    await writeFile(file, String(content), 'utf8');
    const info = await stat(file);
    return {
      id: createId('art'),
      taskId,
      name: filename,
      kind,
      mediaType,
      size: info.size,
      path: `${taskId}/${filename}`,
      createdAt: new Date(info.birthtimeMs || info.mtimeMs).toISOString(),
    };
  }

  async list(taskId) {
    const directory = path.join(this.root, taskId);
    if (!isPathInside(this.root, directory)) throw new Error('Invalid artifact path.');
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const artifacts = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(directory, entry.name);
        const info = await stat(file);
        artifacts.push({
          id: `${taskId}:${entry.name}`,
          taskId,
          name: entry.name,
          kind: inferKind(entry.name),
          mediaType: inferMediaType(entry.name),
          size: info.size,
          path: `${taskId}/${entry.name}`,
          createdAt: new Date(info.birthtimeMs || info.mtimeMs).toISOString(),
        });
      }
      return artifacts;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async read(relativePath) {
    const file = path.resolve(this.root, relativePath);
    if (!isPathInside(this.root, file)) throw new Error('Artifact path escapes the artifact root.');
    return {
      content: await readFile(file),
      mediaType: inferMediaType(file),
      filename: path.basename(file),
    };
  }
}

function inferMediaType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  }[extension] ?? 'application/octet-stream';
}

function inferKind(file) {
  const mediaType = inferMediaType(file);
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType.includes('html')) return 'web';
  if (mediaType.includes('json')) return 'data';
  return 'document';
}
