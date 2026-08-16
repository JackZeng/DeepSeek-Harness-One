import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceTask } from '../src/core/task-reducer.mjs';

const base = { entityId: 'task_a', timestamp: '2026-08-16T00:00:00.000Z', metadata: {} };

test('task reducer builds a complete lifecycle', () => {
  let state = reduceTask(null, { ...base, id: '1', type: 'task.created', payload: { title: 'A', goal: 'Do A', workspaceId: 'ws', mode: 'auto', risk: { level: 'low', reasons: [] } } });
  state = reduceTask(state, { ...base, id: '2', type: 'task.queued', payload: {} });
  state = reduceTask(state, { ...base, id: '3', type: 'task.started', payload: {} });
  state = reduceTask(state, { ...base, id: '4', type: 'task.completed', payload: {} });
  assert.equal(state.status, 'completed');
  assert.equal(state.progress, 100);
});


test('retry resets the visible run while preserving the task identity', () => {
  let state = reduceTask(null, { ...base, id: '1', type: 'task.created', payload: { title: 'A', goal: 'Do A', workspaceId: 'ws', mode: 'auto', risk: { level: 'low', reasons: [] } } });
  state = reduceTask(state, { ...base, id: '2', type: 'task.plan.created', payload: { phases: [{ id: 'p1', status: 'completed', startedAt: base.timestamp, completedAt: base.timestamp }], acceptanceCriteria: [] } });
  state = reduceTask(state, { ...base, id: '3', type: 'task.failed', payload: { error: { message: 'failed' } } });
  state = reduceTask(state, { ...base, id: '4', type: 'task.retry.requested', payload: { previousStatus: 'failed' } });
  assert.equal(state.status, 'draft');
  assert.equal(state.progress, 0);
  assert.equal(state.plan[0].status, 'pending');
  assert.equal(state.error, null);
});
