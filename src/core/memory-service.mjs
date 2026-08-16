import path from 'node:path';
import {
  createId,
  ISO_NOW,
  normalizeWhitespace,
  readJson,
  redactSecrets,
  sha256,
  sortByDateDescending,
  tokenize,
  unique,
  writeJsonAtomic,
} from './utils.mjs';

const EMPTY_MEMORY = Object.freeze({ hot: [], documents: [], spaces: [], candidates: [] });

export class MemoryService {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'state', 'memory.json');
    this.state = structuredClone(EMPTY_MEMORY);
  }

  async init() {
    this.state = { ...structuredClone(EMPTY_MEMORY), ...(await readJson(this.file, EMPTY_MEMORY)) };
    await this.#persist();
  }

  list() {
    return {
      hot: sortByDateDescending(this.state.hot, 'updatedAt'),
      documents: sortByDateDescending(this.state.documents, 'updatedAt'),
      spaces: sortByDateDescending(this.state.spaces, 'updatedAt'),
      candidates: sortByDateDescending(this.state.candidates.filter((item) => item.status === 'pending'), 'createdAt'),
    };
  }

  async propose({ text, source = 'task', workspaceId = null, kind = 'hot', confidence = 0.75 }) {
    const content = this.#sanitizeText(text);
    if (!content) return null;
    const fingerprint = sha256(content.toLowerCase());
    const duplicate = this.#allEntries().find((entry) => entry.fingerprint === fingerprint);
    if (duplicate) return null;

    const candidate = {
      id: createId('memc'),
      text: content,
      kind: ['hot', 'documents', 'spaces'].includes(kind) ? kind : 'hot',
      source,
      workspaceId,
      confidence,
      fingerprint,
      status: 'pending',
      createdAt: ISO_NOW(),
      updatedAt: ISO_NOW(),
    };
    this.state.candidates.push(candidate);
    await this.#persist();
    return candidate;
  }

  async approve(candidateId, overrides = {}) {
    const candidate = this.state.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending') throw new Error('Pending memory candidate not found.');
    const kind = ['hot', 'documents', 'spaces'].includes(overrides.kind) ? overrides.kind : candidate.kind;
    const text = this.#sanitizeText(overrides.text ?? candidate.text);
    if (!text) throw new TypeError('Memory text cannot be empty.');

    const timestamp = ISO_NOW();
    const entry = {
      id: createId('mem'),
      text,
      title: normalizeWhitespace(overrides.title ?? text).slice(0, 80),
      workspaceId: candidate.workspaceId,
      source: candidate.source,
      fingerprint: sha256(text.toLowerCase()),
      tags: unique(overrides.tags ?? inferTags(text)).slice(0, 12),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRecalledAt: null,
      recallCount: 0,
    };
    this.state[kind].push(entry);
    candidate.status = 'approved';
    candidate.updatedAt = timestamp;
    candidate.approvedEntryId = entry.id;
    await this.#persist();
    return entry;
  }

  async reject(candidateId) {
    const candidate = this.state.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending') throw new Error('Pending memory candidate not found.');
    candidate.status = 'rejected';
    candidate.updatedAt = ISO_NOW();
    await this.#persist();
    return candidate;
  }

  async add({ text, kind = 'hot', workspaceId = null, title, tags = [] }) {
    const candidate = await this.propose({ text, source: 'manual', workspaceId, kind, confidence: 1 });
    if (!candidate) throw new Error('This memory already exists or contains no safe content.');
    return this.approve(candidate.id, { title, tags, kind });
  }

  async remove(entryId) {
    let removed = false;
    for (const kind of ['hot', 'documents', 'spaces']) {
      const before = this.state[kind].length;
      this.state[kind] = this.state[kind].filter((item) => item.id !== entryId);
      removed ||= before !== this.state[kind].length;
    }
    if (removed) await this.#persist();
    return removed;
  }

  async recall(query, { workspaceId = null, limit = 8 } = {}) {
    const terms = new Set(tokenize(query));
    const entries = this.#allEntries().filter((entry) => !workspaceId || !entry.workspaceId || entry.workspaceId === workspaceId);
    const ranked = entries
      .map((entry) => ({
        entry,
        score: scoreEntry(entry, terms),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    const recalledAt = ISO_NOW();
    for (const { entry } of ranked) {
      entry.lastRecalledAt = recalledAt;
      entry.recallCount = (entry.recallCount ?? 0) + 1;
      entry.updatedAt = recalledAt;
    }
    if (ranked.length > 0) await this.#persist();
    return ranked.map(({ entry, score }) => ({ ...entry, score }));
  }

  async proposeFromTask(task, workspace) {
    if (!task || task.status !== 'completed') return null;
    const text = `In ${workspace?.name ?? 'this workspace'}, the completed task was: ${task.title}. Preferred execution mode: ${task.mode}.`;
    return this.propose({ text, source: `task:${task.id}`, workspaceId: task.workspaceId, kind: 'hot', confidence: 0.62 });
  }

  #allEntries() {
    return [
      ...this.state.hot,
      ...this.state.documents,
      ...this.state.spaces,
      ...this.state.candidates.filter((item) => item.status === 'pending'),
    ];
  }

  #sanitizeText(value) {
    const normalized = normalizeWhitespace(redactSecrets(value));
    if (!normalized || normalized.includes('[REDACTED_TOKEN]') || normalized.includes('[REDACTED]')) return '';
    return normalized.slice(0, 4000);
  }

  async #persist() {
    await writeJsonAtomic(this.file, this.state);
  }
}

function inferTags(text) {
  return tokenize(text).filter((token) => token.length >= 4).slice(0, 6);
}

function scoreEntry(entry, terms) {
  if (terms.size === 0) return 1;
  const haystack = new Set([...tokenize(entry.text), ...(entry.tags ?? [])]);
  let score = 0;
  for (const term of terms) if (haystack.has(term)) score += 2;
  if (entry.workspaceId) score += 0.25;
  score += Math.min((entry.recallCount ?? 0) * 0.05, 0.5);
  return score;
}
