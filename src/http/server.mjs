import http from 'node:http';
import { readJsonBody, sendError, sendJson, serveStatic } from './http-utils.mjs';

export function createHttpServer({ config, services, sseHub }) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
      const method = request.method ?? 'GET';
      const pathname = decodeURIComponent(url.pathname);

      if (method === 'GET' && pathname === '/api/events') {
        sseHub.connect(request, response);
        return;
      }

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, {
          status: 'ok',
          version: config.appVersion,
          runtime: await services.runtimeManager.status(),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/bootstrap') {
        sendJson(response, 200, {
          app: {
            name: 'DeepSeek Harness One',
            version: config.appVersion,
            demoMode: config.demoMode,
            dataDir: config.dataDir,
          },
          runtime: await services.runtimeManager.status(),
          workspaces: services.workspaceService.list(),
          tasks: services.taskService.list(),
          memory: services.memoryService.list(),
          security: services.securityService.status(),
          extensions: await services.extensionService.list(),
          settings: services.settingsService.get(),
        });
        return;
      }

      if (pathname === '/api/workspaces') {
        if (method === 'GET') sendJson(response, 200, { workspaces: services.workspaceService.list() });
        else if (method === 'POST') sendJson(response, 201, { workspace: await services.workspaceService.add(await readJsonBody(request)) });
        else methodNotAllowed(response);
        return;
      }

      const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
      if (workspaceMatch && method === 'DELETE') {
        sendJson(response, 200, { removed: await services.workspaceService.remove(workspaceMatch[1]) });
        return;
      }

      if (pathname === '/api/tasks') {
        if (method === 'GET') {
          sendJson(response, 200, {
            tasks: services.taskService.list({
              status: url.searchParams.get('status') || undefined,
              workspaceId: url.searchParams.get('workspaceId') || undefined,
            }),
          });
        } else if (method === 'POST') {
          sendJson(response, 201, { task: await services.taskService.create(await readJsonBody(request)) });
        } else methodNotAllowed(response);
        return;
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && method === 'GET') {
        const task = services.taskService.get(taskMatch[1]);
        if (!task) throw new Error('Task not found.');
        sendJson(response, 200, { task });
        return;
      }

      const taskActionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/actions$/);
      if (taskActionMatch && method === 'POST') {
        const body = await readJsonBody(request);
        sendJson(response, 200, { task: await services.taskService.action(taskActionMatch[1], body.action, body) });
        return;
      }

      if (pathname === '/api/memory') {
        if (method === 'GET') sendJson(response, 200, { memory: services.memoryService.list() });
        else if (method === 'POST') sendJson(response, 201, { memory: await services.memoryService.add(await readJsonBody(request)) });
        else methodNotAllowed(response);
        return;
      }

      const memoryCandidateMatch = pathname.match(/^\/api\/memory\/candidates\/([^/]+)$/);
      if (memoryCandidateMatch && method === 'POST') {
        const body = await readJsonBody(request);
        const result = body.action === 'approve'
          ? await services.memoryService.approve(memoryCandidateMatch[1], body)
          : await services.memoryService.reject(memoryCandidateMatch[1]);
        sendJson(response, 200, { result, memory: services.memoryService.list() });
        return;
      }

      const memoryEntryMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
      if (memoryEntryMatch && method === 'DELETE') {
        sendJson(response, 200, { removed: await services.memoryService.remove(memoryEntryMatch[1]) });
        return;
      }

      if (pathname === '/api/memory/recall' && method === 'POST') {
        const body = await readJsonBody(request);
        sendJson(response, 200, { results: await services.memoryService.recall(body.query ?? '', body) });
        return;
      }

      if (pathname === '/api/security') {
        if (method === 'GET') sendJson(response, 200, { security: services.securityService.status() });
        else if (method === 'POST') {
          const workspacePaths = services.workspaceService.list().map((item) => item.path);
          sendJson(response, 200, { security: await services.securityService.scan({ workspacePaths }) });
        } else methodNotAllowed(response);
        return;
      }

      if (pathname === '/api/extensions' && method === 'GET') {
        sendJson(response, 200, { extensions: await services.extensionService.list() });
        return;
      }

      const extensionMatch = pathname.match(/^\/api\/extensions\/([^/]+)$/);
      if (extensionMatch && method === 'POST') {
        const body = await readJsonBody(request);
        if (body.action === 'plan') sendJson(response, 200, { plan: await services.extensionService.plan(extensionMatch[1]) });
        else if (body.action === 'install') {
          const logs = [];
          const result = await services.extensionService.install(extensionMatch[1], (message) => logs.push(message));
          sendJson(response, 200, { result, logs });
        } else throw new TypeError('Extension action must be plan or install.');
        return;
      }

      if (pathname === '/api/settings') {
        if (method === 'GET') sendJson(response, 200, { settings: services.settingsService.get() });
        else if (method === 'PUT') sendJson(response, 200, { settings: await services.settingsService.update(await readJsonBody(request)) });
        else methodNotAllowed(response);
        return;
      }

      const artifactMatch = pathname.match(/^\/api\/artifacts\/(.+)$/);
      if (artifactMatch && method === 'GET') {
        const artifact = await services.artifactService.read(artifactMatch[1]);
        const filename = artifact.filename.replaceAll('"', '');
        response.writeHead(200, {
          'Content-Type': artifact.mediaType,
          'Content-Length': artifact.content.length,
          'Content-Disposition': url.searchParams.get('download') === '1'
            ? `attachment; filename="${filename}"`
            : `inline; filename="${filename}"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Content-Security-Policy': "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:",
        });
        response.end(artifact.content);
        return;
      }

      if (method === 'GET' && await serveStatic(response, config.publicDir, pathname)) return;
      sendJson(response, 404, { error: { message: 'Not found.' } });
    } catch (error) {
      console.error('[http]', error);
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}

function methodNotAllowed(response) {
  sendJson(response, 405, { error: { message: 'Method not allowed.' } }, { Allow: 'GET, POST, PUT, DELETE' });
}
