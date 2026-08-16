import { access } from 'node:fs/promises';
import path from 'node:path';
import { ISO_NOW, isPathInside } from './utils.mjs';

export class ProofService {
  constructor({ strict = true } = {}) {
    this.strict = strict;
  }

  async verify({ task, runtimeResult, workspace, artifacts = [], securityStatus }) {
    const checks = [];
    checks.push(check('runtime-exit', 'Runtime finished successfully', runtimeResult.success === true, true, {
      exitCode: runtimeResult.exitCode ?? null,
    }));
    checks.push(check('final-output', 'A concrete final answer was produced', Boolean(runtimeResult.finalOutput?.trim()), true, {
      length: runtimeResult.finalOutput?.length ?? 0,
    }));
    checks.push(check('plan-terminal', 'Every planned phase reached completion', task.plan.every((phase) => phase.status === 'completed'), true, {
      completed: task.plan.filter((phase) => phase.status === 'completed').length,
      total: task.plan.length,
    }));
    checks.push(check('artifact-present', 'At least one inspectable artifact exists', artifacts.length > 0, this.strict, {
      count: artifacts.length,
    }));
    checks.push(check('security', 'No unresolved high-severity local finding blocks delivery', securityStatus?.summary?.critical === 0 && securityStatus?.summary?.high === 0, false, {
      verdict: securityStatus?.verdict ?? 'unknown',
    }));

    for (const criterion of task.acceptanceCriteria) {
      if (criterion.startsWith('file:')) {
        const relative = criterion.slice(5).trim();
        const candidate = path.resolve(workspace.path, relative);
        const safe = isPathInside(workspace.path, candidate);
        let exists = false;
        if (safe) {
          try {
            await access(candidate);
            exists = true;
          } catch {
            exists = false;
          }
        }
        checks.push(check(`criterion-file-${checks.length}`, `Required file exists: ${relative}`, safe && exists, true, { relative }));
      }
    }

    const required = checks.filter((item) => item.required);
    const passedRequired = required.filter((item) => item.passed).length;
    const score = required.length === 0 ? 100 : Math.round((passedRequired / required.length) * 100);
    return {
      generatedAt: ISO_NOW(),
      verdict: required.every((item) => item.passed) ? 'pass' : 'fail',
      score,
      summary: `${passedRequired}/${required.length} required checks passed`,
      checks,
    };
  }
}

function check(id, label, passed, required, evidence = {}) {
  return { id, label, passed: Boolean(passed), required: Boolean(required), evidence };
}
