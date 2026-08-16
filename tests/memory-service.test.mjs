import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../src/core/memory-service.mjs';
import { testConfig } from './helpers.mjs';

test('memory candidates require explicit approval', async () => {
  const config = await testConfig();
  const memory = new MemoryService({ dataDir: config.dataDir });
  await memory.init();
  const candidate = await memory.propose({ text: 'Mobile visuals use a 3:4 portrait ratio.', workspaceId: 'ws_demo' });
  assert.equal(memory.list().hot.length, 0);
  const entry = await memory.approve(candidate.id);
  assert.equal(entry.workspaceId, 'ws_demo');
  assert.equal(memory.list().hot.length, 1);
  assert.equal(memory.list().candidates.length, 0);
});

test('memory deduplicates normalized content', async () => {
  const config = await testConfig();
  const memory = new MemoryService({ dataDir: config.dataDir });
  await memory.init();
  const first = await memory.propose({ text: 'Prefer local-first operation.' });
  const second = await memory.propose({ text: '  Prefer   local-first operation. ' });
  assert.ok(first);
  assert.equal(second, null);
});

test('memory refuses secret-bearing text', async () => {
  const config = await testConfig();
  const memory = new MemoryService({ dataDir: config.dataDir });
  await memory.init();
  const candidate = await memory.propose({ text: 'api_key=abcdef123456789012345' });
  assert.equal(candidate, null);
});
