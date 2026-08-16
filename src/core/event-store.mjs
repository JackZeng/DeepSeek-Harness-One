import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendJsonLine, createId, ensureDir, ISO_NOW, redactSecrets } from './utils.mjs';

export class EventStore {
  #file;
  #listeners = new Set();
  #writeChain = Promise.resolve();

  constructor({ dataDir, filename = 'events.jsonl' }) {
    this.#file = path.join(dataDir, 'events', filename);
  }

  get file() {
    return this.#file;
  }

  async init() {
    await ensureDir(path.dirname(this.#file));
  }

  async append(type, entityId, payload = {}, metadata = {}) {
    const event = Object.freeze({
      id: createId('evt'),
      type,
      entityId,
      timestamp: ISO_NOW(),
      payload: sanitizePayload(payload),
      metadata: sanitizePayload(metadata),
    });

    this.#writeChain = this.#writeChain.then(() => appendJsonLine(this.#file, event));
    await this.#writeChain;

    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[event-store] listener failed:', error);
      }
    }
    return event;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async readAll() {
    try {
      const text = await readFile(this.#file, 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (error) {
            throw new Error(`Invalid event JSON at line ${index + 1}: ${error.message}`);
          }
        });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async readFor(entityId) {
    return (await this.readAll()).filter((event) => event.entityId === entityId);
  }
}

function sanitizePayload(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizePayload(nested)]),
    );
  }
  return value;
}
