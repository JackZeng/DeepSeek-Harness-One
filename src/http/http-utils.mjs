import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, toErrorPayload } from '../core/utils.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export function sendJson(response, statusCode, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

export function sendError(response, error, statusCode = inferStatus(error)) {
  sendJson(response, statusCode, { error: toErrorPayload(error) });
}

export async function readJsonBody(request, { maximumBytes = 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new TypeError('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export async function serveStatic(response, publicRoot, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(publicRoot, requested);
  if (!isPathInside(publicRoot, file)) return false;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
    const content = await readFile(file);
    const extension = path.extname(file).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' && !pathname.startsWith('/api/')) {
      try {
        const content = await readFile(path.join(publicRoot, 'index.html'));
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
        });
        response.end(content);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function inferStatus(error) {
  if (error?.statusCode) return error.statusCode;
  if (error instanceof TypeError) return 400;
  if (/not found/i.test(error?.message ?? '')) return 404;
  if (/disabled|approve|permission/i.test(error?.message ?? '')) return 403;
  return 500;
}
