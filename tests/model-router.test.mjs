import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.mjs';

const router = new ModelRouter();

test('auto mode uses strong planning and economical execution for routine work', () => {
  const route = router.route({ goal: 'Rename a heading in the README', mode: 'auto', risk: { level: 'low' } });
  assert.equal(route.planning.tier, 'strong');
  assert.equal(route.execution.tier, 'cheap');
  assert.equal(route.review.tier, 'strong');
});

test('high-risk work escalates execution to strong tier', () => {
  const route = router.route({ goal: 'Deploy the database migration to production', mode: 'auto', risk: { level: 'high' } });
  assert.equal(route.execution.tier, 'strong');
  assert.ok(route.complexityScore >= 4);
});

test('deep mode keeps every stage on the strong tier', () => {
  const route = router.route({ goal: 'Create an architecture', mode: 'deep', risk: { level: 'low' } });
  assert.deepEqual([route.planning.tier, route.execution.tier, route.review.tier], ['strong', 'strong', 'strong']);
});
