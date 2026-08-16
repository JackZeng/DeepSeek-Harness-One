import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProofService } from '../src/core/proof-service.mjs';
import { testConfig } from './helpers.mjs';

test('proof passes when runtime, plan, artifact and required file are present', async () => {
  const config = await testConfig();
  const workspace = { path: path.join(config.dataDir, 'workspace') };
  await mkdir(workspace.path, { recursive: true });
  await writeFile(path.join(workspace.path, 'result.txt'), 'ok');
  const proof = await new ProofService({ strict: true }).verify({
    task: { plan: [{ status: 'completed' }], acceptanceCriteria: ['file:result.txt'] },
    runtimeResult: { success: true, exitCode: 0, finalOutput: 'done' },
    workspace,
    artifacts: [{ id: 'a' }],
    securityStatus: { summary: { critical: 0, high: 0 }, verdict: 'good' },
  });
  assert.equal(proof.verdict, 'pass');
  assert.equal(proof.score, 100);
});
