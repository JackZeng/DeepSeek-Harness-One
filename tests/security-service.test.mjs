import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityService } from '../src/core/security-service.mjs';
import { testConfig } from './helpers.mjs';

test('high-impact goals require approval', async () => {
  const service = new SecurityService({ config: await testConfig() });
  const risk = service.classifyGoal('Delete all production credentials and push to main');
  assert.equal(risk.level, 'high');
  assert.ok(risk.reasons.length >= 2);
});

test('ordinary local work remains low risk', async () => {
  const service = new SecurityService({ config: await testConfig() });
  assert.deepEqual(service.classifyGoal('Summarize this local README'), { level: 'low', reasons: [] });
});
