import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from './core/event-store.mjs';
import { WorkspaceService } from './core/workspace-service.mjs';
import { MemoryService } from './core/memory-service.mjs';
import { ArtifactService } from './core/artifact-service.mjs';
import { SecurityService } from './core/security-service.mjs';
import { SettingsService } from './core/settings-service.mjs';
import { Planner } from './core/planner.mjs';
import { ModelRouter } from './core/model-router.mjs';
import { ProofService } from './core/proof-service.mjs';
import { TaskService } from './core/task-service.mjs';
import { DemoRuntime } from './runtime/demo-runtime.mjs';
import { DshRuntime } from './runtime/dsh-runtime.mjs';
import { RuntimeManager } from './runtime/runtime-manager.mjs';
import { ExtensionService } from './integrations/extension-service.mjs';
import { SseHub } from './http/sse-hub.mjs';
import { createHttpServer } from './http/server.mjs';
import { ensureDir } from './core/utils.mjs';

export async function createApplication(config) {
  await ensureDir(config.dataDir);
  const sseHub = new SseHub();
  const eventStore = new EventStore({ dataDir: config.dataDir });
  const workspaceService = new WorkspaceService({ dataDir: config.dataDir });
  const memoryService = new MemoryService({ dataDir: config.dataDir });
  const artifactService = new ArtifactService({ dataDir: config.dataDir });
  const securityService = new SecurityService({ config });
  const settingsService = new SettingsService({ dataDir: config.dataDir, config });
  const extensionService = new ExtensionService({
    config,
    registryFile: path.resolve(fileURLToPath(new URL('../config/integrations.json', import.meta.url))),
  });
  const planner = new Planner();
  const modelRouter = new ModelRouter();
  const proofService = new ProofService({ strict: config.proofStrict });
  const demoRuntime = new DemoRuntime({ artifactService });
  const dshRuntime = new DshRuntime({ config, artifactService });
  const runtimeManager = new RuntimeManager({ config, dshRuntime, demoRuntime });

  await Promise.all([
    eventStore.init(),
    workspaceService.init(),
    memoryService.init(),
    artifactService.init(),
    settingsService.init(),
    extensionService.init(),
  ]);

  const taskService = new TaskService({
    eventStore,
    planner,
    modelRouter,
    securityService,
    memoryService,
    workspaceService,
    artifactService,
    proofService,
    runtimeManager,
    settingsService,
    concurrency: config.concurrency,
  });
  await taskService.init();

  eventStore.subscribe((event) => sseHub.publish('domain-event', event));
  taskService.subscribe(({ task }) => {
    if (task) sseHub.publish('task-updated', task);
  });

  const services = {
    eventStore,
    workspaceService,
    memoryService,
    artifactService,
    securityService,
    settingsService,
    extensionService,
    planner,
    modelRouter,
    proofService,
    runtimeManager,
    taskService,
  };
  const server = createHttpServer({ config, services, sseHub });

  return {
    config,
    services,
    server,
    async start() {
      server.listen(config.port, config.host);
      await once(server, 'listening');
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      return { host: config.host, port, url: `http://${displayHost(config.host)}:${port}` };
    },
    async stop() {
      await taskService.shutdown();
      sseHub.close();
      if (server.listening) {
        server.close();
        await once(server, 'close');
      }
    },
  };
}

function displayHost(host) {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
