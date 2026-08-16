import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';

export async function testConfig(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-one-test-'));
  return {
    ...loadConfig({
      dataDir: path.join(root, 'data'),
      dshHome: path.join(root, 'dsh'),
      publicDir: path.resolve(fileURLToPath(new URL('../public', import.meta.url))),
      demoMode: true,
      openBrowser: false,
      proofStrict: true,
      ...overrides,
    }),
    port: overrides.port ?? 0,
  };
}
