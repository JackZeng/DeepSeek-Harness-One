import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ISO_NOW, isPathInside, pathExists, redactSecrets } from './utils.mjs';

const HIGH_RISK_PATTERNS = [
  { code: 'destructive-delete', pattern: /\brm\s+-[^\n]*r[^\n]*f|\bdelete\s+(?:all|everything)|\bdrop\s+(?:database|table)|清空|全部删除/i },
  { code: 'production-change', pattern: /\bproduction\b|\bprod\b|生产环境/i },
  { code: 'credential-access', pattern: /\bcredential|\bsecret|\.env\b|private\s+key|api\s*key|凭据|密钥|私钥/i },
  { code: 'external-publish', pattern: /\bpublish|\bdeploy|\bpush\s+to\s+main|发布|部署|推送到主分支/i },
  { code: 'financial-action', pattern: /\bpayment|\btransfer|\bpurchase|付款|转账|购买/i },
];

const MEDIUM_RISK_PATTERNS = [
  { code: 'network-action', pattern: /\bcurl\b|\bwget\b|download|upload|联网|下载|上传/i },
  { code: 'package-install', pattern: /\binstall\b|npm\s+i|pnpm\s+add|pip\s+install|安装依赖/i },
  { code: 'account-action', pattern: /\blogin|register|account|登录|注册|账户/i },
];

const SENSITIVE_FILENAMES = [
  '.env',
  '.env.local',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
  'secrets.json',
];

export class SecurityService {
  constructor({ config }) {
    this.config = config;
    this.lastReport = null;
  }

  classifyGoal(goal) {
    const highReasons = HIGH_RISK_PATTERNS.filter(({ pattern }) => pattern.test(goal)).map(({ code }) => code);
    if (highReasons.length > 0) return { level: 'high', reasons: highReasons };
    const mediumReasons = MEDIUM_RISK_PATTERNS.filter(({ pattern }) => pattern.test(goal)).map(({ code }) => code);
    if (mediumReasons.length > 0) return { level: 'medium', reasons: mediumReasons };
    return { level: 'low', reasons: [] };
  }

  evaluateCommand(command) {
    const risk = this.classifyGoal(command);
    return {
      decision: risk.level === 'high' ? 'require-approval' : 'allow',
      risk,
      command: redactSecrets(command),
    };
  }

  async scan({ workspacePaths = [] } = {}) {
    const findings = [];
    if (!['127.0.0.1', '::1', 'localhost'].includes(this.config.host)) {
      findings.push(finding('network-listen', 'high', `Control plane listens on ${this.config.host}.`));
    }

    if (await pathExists(this.config.dshHome)) {
      findings.push(...await this.#scanDirectory(this.config.dshHome, 'dsh-home'));
    }

    for (const workspacePath of workspacePaths) {
      if (await pathExists(workspacePath)) {
        findings.push(...await this.#scanDirectory(workspacePath, 'workspace', { maximumDepth: 2 }));
      }
    }

    const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
    const highest = findings.reduce(
      (current, item) => severityRank[item.severity] > severityRank[current] ? item.severity : current,
      'low',
    );
    const report = {
      generatedAt: ISO_NOW(),
      verdict: findings.some((item) => ['critical', 'high'].includes(item.severity)) ? 'attention' : 'good',
      highestSeverity: findings.length === 0 ? 'none' : highest,
      summary: {
        critical: findings.filter((item) => item.severity === 'critical').length,
        high: findings.filter((item) => item.severity === 'high').length,
        medium: findings.filter((item) => item.severity === 'medium').length,
        low: findings.filter((item) => item.severity === 'low').length,
      },
      findings: findings.slice(0, 200),
      coverage: 'bounded-local-scan',
    };
    this.lastReport = report;
    return report;
  }

  status() {
    return this.lastReport ?? {
      generatedAt: null,
      verdict: 'unknown',
      highestSeverity: 'unknown',
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      coverage: 'not-scanned',
    };
  }

  async #scanDirectory(root, scope, { maximumDepth = 3 } = {}) {
    const findings = [];
    const visit = async (directory, depth) => {
      if (depth > maximumDepth || findings.length >= 200) return;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        findings.push(finding('scan-error', 'low', `Could not inspect ${scope} directory.`, { code: error.code }));
        return;
      }

      for (const entry of entries.slice(0, 300)) {
        const fullPath = path.join(directory, entry.name);
        if (!isPathInside(root, fullPath)) continue;
        if (entry.isSymbolicLink()) {
          findings.push(finding('symlink-present', 'low', `Symbolic link found in ${scope}.`, { path: relativeSafe(root, fullPath) }));
          continue;
        }
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) await visit(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (SENSITIVE_FILENAMES.includes(lower) || lower.endsWith('.pem') || lower.endsWith('.key')) {
          const info = await stat(fullPath);
          const mode = info.mode & 0o777;
          findings.push(
            finding(
              'sensitive-file',
              mode & 0o077 ? 'high' : 'medium',
              `Sensitive-looking file exists in ${scope}.`,
              { path: relativeSafe(root, fullPath), mode: mode.toString(8).padStart(3, '0') },
            ),
          );
        }
      }
    };
    await visit(root, 0);
    return findings;
  }
}

function finding(code, severity, message, evidence = {}) {
  return { code, severity, message, evidence };
}

function relativeSafe(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}
