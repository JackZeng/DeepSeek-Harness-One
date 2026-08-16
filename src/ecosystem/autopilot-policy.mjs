import path from 'node:path';

const TRAIT_RULES = [
  ['durable workflow and recovery', /\b(workflow|resume|checkpoint|replay|durable|recover|continuation|idempotent)\b/i],
  ['supervised memory and knowledge continuity', /\b(memory|knowledge graph|recall|context|long[- ]term|deduplication)\b/i],
  ['independent verification and evidence', /\b(proof|verification|acceptance|evidence|eval|benchmark|quality gate|receipt)\b/i],
  ['security, permissions and guardrails', /\b(security|guardrails?|sandbox|permission|approval|secret|prompt injection|audit|policy)\b/i],
  ['automatic model and capability routing', /\b(router|routing|tier|model selection|provider|fallback|failover|escalation)\b/i],
  ['inspectable artifacts and editable results', /\b(artifact|canvas|export|preview|editable|report|diagram|render)\b/i],
  ['human-agent task collaboration', /\b(task board|human[- ]in[- ]the[- ]loop|collaboration|approval queue|workspace|mission control)\b/i],
  ['visual understanding and structured evidence', /\b(vision|image|ocr|layout|screenshot|multimodal|document understanding)\b/i],
  ['local-first privacy and portability', /\b(local[- ]first|self[- ]hosted|privacy|offline|portable|single binary)\b/i],
  ['extension discovery and lifecycle management', /\b(plugin market|marketplace|registry|extension|one[- ]click install|update|uninstall)\b/i],
];

const UNSAFE_ADDED_LINE_RULES = [
  ['new subprocess capability', /\b(?:node:child_process|child_process|spawnSync|execSync|execFileSync|\bspawn\s*\(|\bexec\s*\(|\bexecFile\s*\()/],
  ['new network server or socket capability', /\b(?:node:(?:net|tls|dgram|http|https|http2)|createServer\s*\(|WebSocket\s*\(|new\s+WebSocket\b)/],
  ['new outbound network request', /\b(?:fetch\s*\(|EventSource\s*\(|XMLHttpRequest\b)/],
  ['new environment-secret access', /\bprocess\.env\b/],
  ['dynamic code execution', /\b(?:eval\s*\(|new\s+Function\s*\(|node:vm\b|runInNewContext\b)/],
  ['destructive shell instruction', /\b(?:rm\s+-rf|mkfs\b|git\s+push\s+--force|sudo\b|curl\b[^\n]*\|\s*(?:ba)?sh\b|wget\b[^\n]*\|\s*(?:ba)?sh\b)/i],
  ['external executable script reference', /<(?:script|iframe)\b[^>]+(?:src|href)=["']https?:\/\//i],
];

export function normalizeLicense(value) {
  const license = String(value || 'NOASSERTION').trim();
  return license || 'NOASSERTION';
}

export function inferTraits(text, limit = TRAIT_RULES.length) {
  const source = String(text || '');
  return TRAIT_RULES.filter(([, pattern]) => pattern.test(source))
    .slice(0, limit)
    .map(([trait]) => trait);
}

export function scoreCandidate(repository, options = {}) {
  if (!repository || repository.archived || repository.fork) return -1000;
  const now = options.now ?? Date.now();
  const allowedLicenses = new Set(options.allowedLicenses || []);
  const ownRepository = String(options.ownRepository || '').toLowerCase();
  const fullName = String(repository.full_name || repository.fullName || '');
  if (fullName.toLowerCase() === ownRepository) return -1000;

  const topics = Array.isArray(repository.topics) ? repository.topics : [];
  const text = [repository.name, repository.description, ...topics]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;
  if (topics.includes('dsh-plugin')) score += 38;
  if (topics.includes('deepseek-harness') || topics.includes('dsh')) score += 26;
  if (/deepseek[ -]?harness|\bdsh\b/.test(text)) score += 24;
  if (/agent|workflow|memory|guardrail|artifact|sandbox|plugin/.test(text)) score += 8;

  const stars = Number(repository.stargazers_count ?? repository.stars ?? 0);
  score += Math.min(24, Math.log10(stars + 1) * 8);

  const pushedAt = Date.parse(repository.pushed_at || repository.pushedAt || 0);
  if (Number.isFinite(pushedAt) && pushedAt > 0) {
    const ageDays = Math.max(0, (now - pushedAt) / 86_400_000);
    score += Math.max(0, 18 - ageDays / 5);
  }

  const license = normalizeLicense(repository.license?.spdx_id ?? repository.license);
  if (allowedLicenses.has(license)) score += 10;
  else if (license === 'NOASSERTION') score -= 8;
  else score -= 16;

  const previous = options.previous;
  if (!previous) score += 8;
  else if (previous.pushedAt !== (repository.pushed_at || repository.pushedAt)) score += 5;
  else score -= 4;

  if (options.currentIntegration) score -= previous?.pushedAt === (repository.pushed_at || repository.pushedAt) ? 12 : 3;
  score += Math.min(8, Number(options.queryHits || 1) * 2);
  return Math.round(score * 10) / 10;
}

export function rankCandidates(repositories, options = {}) {
  const integrations = new Set((options.integratedRepositories || []).map((value) => String(value).toLowerCase()));
  return repositories
    .map((repository) => ({
      ...repository,
      score: scoreCandidate(repository, {
        ...options,
        previous: options.seen?.[repository.full_name || repository.fullName],
        queryHits: repository.queryHits,
        currentIntegration: integrations.has(String(repository.full_name || repository.fullName).toLowerCase()),
      }),
      alreadyIntegrated: integrations.has(String(repository.full_name || repository.fullName).toLowerCase()),
    }))
    .filter((repository) => repository.score > 0)
    .sort((a, b) => b.score - a.score || String(a.full_name).localeCompare(String(b.full_name)));
}

export function changedPathsFromPatch(patch) {
  const paths = new Set();
  for (const line of String(patch || '').split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) continue;
    paths.add(match[2]);
  }
  return [...paths];
}

export function parseNumstat(text) {
  return String(text || '').trim().split('\n').filter(Boolean).map((line) => {
    const [addedRaw, deletedRaw, ...rest] = line.split('\t');
    return {
      additions: addedRaw === '-' ? 0 : Number(addedRaw || 0),
      deletions: deletedRaw === '-' ? 0 : Number(deletedRaw || 0),
      path: rest.join('\t'),
    };
  });
}

export function validateAutopilotDiff(entries, config) {
  const errors = [];
  const files = entries.map((entry) => normalizePath(entry.path));
  const additions = entries.reduce((sum, entry) => sum + Number(entry.additions || 0), 0);
  const deletions = entries.reduce((sum, entry) => sum + Number(entry.deletions || 0), 0);
  const allowedRoots = config.allowedPatchRoots || [];
  const protectedPaths = new Set(config.protectedPaths || []);

  if (files.length > config.maxPatchFiles) errors.push(`Patch changes ${files.length} files; limit is ${config.maxPatchFiles}.`);
  if (additions > config.maxPatchAdditions) errors.push(`Patch adds ${additions} lines; limit is ${config.maxPatchAdditions}.`);
  if (deletions > config.maxPatchDeletions) errors.push(`Patch deletes ${deletions} lines; limit is ${config.maxPatchDeletions}.`);

  for (const file of files) {
    if (!file || file.startsWith('../') || path.isAbsolute(file)) errors.push(`Unsafe path: ${file}`);
    if (file.includes('\0') || file.includes('/.git/') || file === '.git') errors.push(`Forbidden repository-internal path: ${file}`);
    if (protectedPaths.has(file)) errors.push(`Protected path cannot be changed by automation: ${file}`);
    if (!allowedRoots.some((root) => file === root || file.startsWith(root))) {
      errors.push(`Path is outside the autonomous integration boundary: ${file}`);
    }
  }

  const codeChanged = files.some((file) => /^(?:src|public)\//.test(file));
  const testsChanged = files.some((file) => /^tests\/.+\.test\.mjs$/.test(file));
  if (config.requireTestsForCode && codeChanged && !testsChanged) {
    errors.push('A product code change must include or update a regression test.');
  }

  return { ok: errors.length === 0, errors, files, additions, deletions };
}

export function validateGeneratedPatch(patch, allowedTargets = []) {
  const errors = [];
  const source = String(patch || '');
  const paths = changedPathsFromPatch(source);
  const targetSet = new Set(allowedTargets.map(normalizePath));

  if (!source.startsWith('diff --git ')) errors.push('Patch is not a unified git diff.');
  if (/^GIT binary patch$/m.test(source) || /^Binary files /m.test(source)) errors.push('Binary patches are not allowed.');
  if (/^(?:new|old) file mode 120000$/m.test(source)) errors.push('Symlink changes are not allowed.');
  if (/^Submodule /m.test(source) || /\.gitmodules/.test(source)) errors.push('Submodules are not allowed.');
  if (/^rename (?:from|to) /m.test(source)) errors.push('Renames are not allowed in autonomous patches.');
  if (paths.length === 0) errors.push('Patch changes no files.');
  if (targetSet.size > 0) {
    for (const file of paths) {
      if (!targetSet.has(normalizePath(file))) errors.push(`Patch changes an undeclared target: ${file}`);
    }
  }

  return { ok: errors.length === 0, errors, paths };
}

export function validateAddedContent(diff) {
  const errors = [];
  const addedLines = [];
  let currentPath = '';
  for (const line of String(diff || '').split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      currentPath = normalizePath(header[2]);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (!/^(?:src|public)\//.test(currentPath)) continue;
    addedLines.push(line.slice(1));
  }
  const added = addedLines.join('\n');

  for (const [label, pattern] of UNSAFE_ADDED_LINE_RULES) {
    if (pattern.test(added)) errors.push(`Autonomous patch introduces ${label}.`);
  }
  if (/https?:\/\//i.test(added)) {
    errors.push('Autonomous product-code changes may not introduce external URLs.');
  }
  if (/\b(?:api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'][^"']{8,}/i.test(added)) {
    errors.push('Autonomous patch contains credential-like assignment material.');
  }
  return { ok: errors.length === 0, errors };
}

export function validateIntegrationRegistry(previousEntries, nextEntries, config = {}) {
  const errors = [];
  if (!Array.isArray(previousEntries) || !Array.isArray(nextEntries)) {
    return { ok: false, errors: ['Integration registry must remain a JSON array.'], additions: [] };
  }
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
  const nextById = new Map();
  const repositories = new Set();
  for (const entry of nextEntries) {
    if (!entry || typeof entry !== 'object') { errors.push('Every integration entry must be an object.'); continue; }
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(String(entry.id || ''))) errors.push(`Invalid integration id: ${entry.id || '<missing>'}`);
    if (nextById.has(entry.id)) errors.push(`Duplicate integration id: ${entry.id}`);
    nextById.set(entry.id, entry);
    const repository = String(entry.repository || '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) errors.push(`Invalid integration repository: ${repository || '<missing>'}`);
    if (repositories.has(repository.toLowerCase())) errors.push(`Duplicate integration repository: ${repository}`);
    repositories.add(repository.toLowerCase());
  }
  for (const [id, previous] of previousById) {
    const next = nextById.get(id);
    if (!next) { errors.push(`Existing integration may not be removed: ${id}`); continue; }
    if (JSON.stringify(next) !== JSON.stringify(previous)) errors.push(`Existing integration may not be rewritten autonomously: ${id}`);
  }
  const additions = nextEntries.filter((entry) => !previousById.has(entry.id));
  if (additions.length > Number(config.maxIntegrationsPerRun || 1)) errors.push('Autopilot may add at most one integration registry entry per run.');
  const allowedLicenses = new Set(config.allowedLicenses || []);
  for (const entry of additions) {
    if (entry.tier !== 'optional') errors.push(`New integration ${entry.id} must begin as optional.`);
    if (!allowedLicenses.has(String(entry.license || ''))) errors.push(`New integration ${entry.id} has an ineligible license.`);
    if (!['capability', 'ecosystem', 'enterprise', 'execution', 'memory', 'quality', 'security', 'studio', 'team'].includes(entry.category)) {
      errors.push(`New integration ${entry.id} has an unsupported category.`);
    }
    if (!Array.isArray(entry.permissions) || entry.permissions.length > 12 || entry.permissions.some((value) => typeof value !== 'string' || value.length > 80)) {
      errors.push(`New integration ${entry.id} has invalid permissions.`);
    }
    const install = entry.install || {};
    if (!['dsh-plugin', 'external', 'guided'].includes(install.kind)) errors.push(`New integration ${entry.id} has an unsupported install kind.`);
    if (install.source && !/^(?:@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+|github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9._/-]+)?)$/.test(install.source)) {
      errors.push(`New integration ${entry.id} has an unsafe plugin source.`);
    }
    for (const command of install.commands || []) {
      if (typeof command !== 'string' || command.length > 300 || /[;&|><`$]/.test(command) || /\b(?:curl|wget|sudo|rm\s+-rf)\b/i.test(command)) {
        errors.push(`New integration ${entry.id} has an unsafe guided command.`);
      }
    }
  }
  return { ok: errors.length === 0, errors, additions };
}

export function containsCredentialMaterial(text) {
  const source = String(text || '');
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/,
    /\bnpm_[A-Za-z0-9]{30,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i,
  ].some((pattern) => pattern.test(source));
}

export function extractJsonObject(text) {
  const source = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(source); }
  catch {}

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Model response did not contain a JSON object.');
  return JSON.parse(source.slice(start, end + 1));
}

export function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}
