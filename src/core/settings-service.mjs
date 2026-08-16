import path from 'node:path';
import { readJson, writeJsonAtomic } from './utils.mjs';

const DEFAULTS = Object.freeze({
  displayName: '',
  defaultMode: 'auto',
  autoRunTasks: true,
  proofStrict: true,
  memorySuggestions: true,
  guardrails: true,
  theme: 'system',
  developerDetails: false,
});

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

export class SettingsService {
  constructor({ dataDir, config }) {
    this.file = path.join(dataDir, 'state', 'settings.json');
    this.config = config;
    this.value = { ...DEFAULTS, defaultMode: config.defaultMode, proofStrict: config.proofStrict };
  }

  async init() {
    this.value = { ...this.value, ...(await readJson(this.file, {})) };
    await writeJsonAtomic(this.file, this.value);
  }

  get() {
    return structuredClone(this.value);
  }

  async update(patch) {
    const sanitized = {};
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (ALLOWED_KEYS.has(key)) sanitized[key] = value;
    }
    if (sanitized.displayName !== undefined) {
      sanitized.displayName = String(sanitized.displayName ?? '').trim().slice(0, 80);
    }
    if (sanitized.defaultMode && !['fast', 'auto', 'deep'].includes(sanitized.defaultMode)) {
      throw new TypeError('defaultMode must be fast, auto, or deep.');
    }
    if (sanitized.theme && !['system', 'light', 'dark'].includes(sanitized.theme)) {
      throw new TypeError('theme must be system, light, or dark.');
    }
    this.value = { ...this.value, ...sanitized };
    await writeJsonAtomic(this.file, this.value);
    return this.get();
  }
}
