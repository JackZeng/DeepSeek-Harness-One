import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../src/core/event-store.mjs';
import { testConfig } from './helpers.mjs';

test('event store appends and replays durable events in order', async () => {
  const config = await testConfig();
  const store = new EventStore({ dataDir: config.dataDir });
  await store.init();
  await store.append('task.created', 'task_one', { title: 'One' });
  await store.append('task.queued', 'task_one', {});
  const events = await store.readAll();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.type), ['task.created', 'task.queued']);
  assert.equal((await store.readFor('task_one')).length, 2);
});

test('event store redacts token-like values before persistence', async () => {
  const config = await testConfig();
  const store = new EventStore({ dataDir: config.dataDir });
  await store.init();
  await store.append('task.log', 'task_secret', { message: 'api_key=abcdef123456789012345' });
  const [event] = await store.readAll();
  assert.doesNotMatch(event.payload.message, /abcdef/);
});
