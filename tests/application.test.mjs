import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.mjs';
import { testConfig } from './helpers.mjs';

test('demo task runs end-to-end with artifact, proof and memory candidate', async (t) => {
  const config = await testConfig();
  const application = await createApplication(config);
  t.after(() => application.stop());
  const task = await application.services.taskService.create({
    goal: 'Create an inspectable product brief',
    workspaceId: 'ws_demo',
    autoRun: true,
  });
  const completed = await application.services.taskService.waitForTerminal(task.id, { timeoutMs: 10000 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.proof.verdict, 'pass');
  assert.ok(completed.artifacts.length >= 1);
  assert.ok(application.services.memoryService.list().candidates.length >= 1);
});

test('high-impact task waits for explicit approval', async (t) => {
  const config = await testConfig();
  const application = await createApplication(config);
  t.after(() => application.stop());
  const task = await application.services.taskService.create({
    goal: 'Deploy to production and push to main',
    workspaceId: 'ws_demo',
    autoRun: true,
  });
  assert.equal(task.status, 'awaiting_approval');
});

test('HTTP bootstrap and static app are available', async (t) => {
  const config = await testConfig({ port: 0 });
  const application = await createApplication(config);
  const address = await application.start();
  t.after(() => application.stop());
  const health = await fetch(`${address.url}/api/health`).then((response) => response.json());
  assert.equal(health.status, 'ok');
  const html = await fetch(address.url).then((response) => response.text());
  assert.match(html, /DeepSeek Harness One/);
});

test('a cancelled queued task can be run again cleanly', async (t) => {
  const config = await testConfig({ concurrency: 1 });
  const application = await createApplication(config);
  t.after(() => application.stop());

  const first = await application.services.taskService.create({
    goal: 'Create the first inspectable brief',
    workspaceId: 'ws_demo',
    autoRun: true,
  });
  const second = await application.services.taskService.create({
    goal: 'Create the second inspectable brief',
    workspaceId: 'ws_demo',
    autoRun: true,
  });

  const cancelled = await application.services.taskService.action(second.id, 'cancel');
  assert.equal(cancelled.status, 'cancelled');
  await application.services.taskService.action(second.id, 'retry');
  const completed = await application.services.taskService.waitForTerminal(second.id, { timeoutMs: 15000 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.attempt, 1);
  await application.services.taskService.waitForTerminal(first.id, { timeoutMs: 15000 });
});

test('graceful shutdown records active work as interrupted', async () => {
  const config = await testConfig();
  const application = await createApplication(config);
  const task = await application.services.taskService.create({
    goal: 'Create a brief that will be interrupted by shutdown',
    workspaceId: 'ws_demo',
    autoRun: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await application.stop();

  const restarted = await createApplication(config);
  try {
    assert.equal(restarted.services.taskService.get(task.id).status, 'interrupted');
  } finally {
    await restarted.stop();
  }
});

test('artifact responses are isolated with a sandbox content policy', async (t) => {
  const config = await testConfig({ port: 0 });
  const application = await createApplication(config);
  const address = await application.start();
  t.after(() => application.stop());
  const task = await application.services.taskService.create({
    goal: 'Create an inspectable delivery artifact',
    workspaceId: 'ws_demo',
    autoRun: true,
  });
  const completed = await application.services.taskService.waitForTerminal(task.id, { timeoutMs: 10000 });
  const artifact = completed.artifacts.find((item) => !item.external);
  assert.ok(artifact);
  const relative = artifact.path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${address.url}/api/artifacts/${relative}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('local display name is configurable and bounded', async (t) => {
  const config = await testConfig();
  const application = await createApplication(config);
  t.after(() => application.stop());
  const updated = await application.services.settingsService.update({ displayName: `  ${'J'.repeat(100)}  ` });
  assert.equal(updated.displayName.length, 80);
  assert.equal(updated.displayName, 'J'.repeat(80));
});
