import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtensionService } from '../src/integrations/extension-service.mjs';
import { testConfig } from './helpers.mjs';

test('extension registry exposes a safe install plan', async () => {
  const config = await testConfig();
  const service = new ExtensionService({
    config,
    registryFile: path.resolve(fileURLToPath(new URL('../config/integrations.json', import.meta.url))),
  });
  await service.init();
  const plan = await service.plan('dsh-proof');
  assert.match(plan.commands[0], /dsh plugin --profile headless add/);
  assert.equal(plan.automatic, false);
});
