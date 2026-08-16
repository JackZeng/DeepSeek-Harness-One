import { createHash, randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ISO_NOW = () => new Date().toISOString();

export function createId(prefix = 'id') {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function pathExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function readJson(file, fallback) {
  try {
    const content = await readFile(file, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export async function appendJsonLine(file, value) {
  await ensureDir(path.dirname(file));
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function clamp(number, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, number));
}

export function asPositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

export function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function safeFilename(value, fallback = 'artifact') {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return normalized || fallback;
}

export function redactSecrets(value) {
  const text = String(value ?? '');
  return text
    .replace(/\b(sk|pk|rk|api|token|key)[-_]?[a-z0-9]{12,}\b/gi, '[REDACTED_TOKEN]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function toErrorPayload(error) {
  return {
    name: error?.name ?? 'Error',
    message: redactSecrets(error?.message ?? String(error)),
    code: error?.code ?? null,
  };
}

export function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function sortByDateDescending(items, key = 'updatedAt') {
  return [...items].sort((left, right) => String(right[key] ?? '').localeCompare(String(left[key] ?? '')));
}

export function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length > 1);
}

export function unique(items) {
  return [...new Set(items)];
}
