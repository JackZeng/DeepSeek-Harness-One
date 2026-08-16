import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asBoolean, asPositiveInteger, expandHome } from './core/utils.mjs';

export function loadConfig(overrides = {}) {
  const environment = process.env;
  const dataDir = path.resolve(
    expandHome(overrides.dataDir ?? environment.DSH_ONE_DATA_DIR ?? '~/.dsh-one'),
  );

  return Object.freeze({
    host: overrides.host ?? environment.DSH_ONE_HOST ?? '127.0.0.1',
    port: asPositiveInteger(overrides.port ?? environment.DSH_ONE_PORT, 3210, 65535),
    dataDir,
    publicDir: path.resolve(overrides.publicDir ?? fileURLToPath(new URL('../public', import.meta.url))),
    dshHome: path.resolve(expandHome(overrides.dshHome ?? environment.DSH_HOME ?? '~/.dsh')),
    dshCommand: overrides.dshCommand ?? environment.DSH_ONE_DSH_COMMAND ?? 'dsh',
    dshProfile: overrides.dshProfile ?? environment.DSH_ONE_DSH_PROFILE ?? 'headless',
    defaultMode: overrides.defaultMode ?? environment.DSH_ONE_DEFAULT_MODE ?? 'auto',
    concurrency: asPositiveInteger(overrides.concurrency ?? environment.DSH_ONE_CONCURRENCY, 2, 8),
    demoMode: asBoolean(overrides.demoMode ?? environment.DSH_ONE_DEMO, false),
    openBrowser: asBoolean(overrides.openBrowser ?? environment.DSH_ONE_OPEN_BROWSER, true),
    allowExtensionInstall: asBoolean(
      overrides.allowExtensionInstall ?? environment.DSH_ONE_ALLOW_EXTENSION_INSTALL,
      false,
    ),
    proofStrict: asBoolean(overrides.proofStrict ?? environment.DSH_ONE_PROOF_STRICT, true),
    appVersion: '0.1.0',
  });
}
