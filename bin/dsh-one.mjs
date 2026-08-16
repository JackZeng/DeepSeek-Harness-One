#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadConfig } from '../src/config.mjs';
import { createApplication } from '../src/app.mjs';
import { runDoctor } from '../src/doctor.mjs';
import { buildRecommendedInstallPlan, formatInstallPlan } from '../src/integrations/profile-builder.mjs';
import { ExtensionService } from '../src/integrations/extension-service.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [command = 'serve', ...args] = process.argv.slice(2);

try {
  if (command === 'serve') await serve(args);
  else if (command === 'doctor') await doctor(args);
  else if (command === 'setup') await setup(args);
  else if (command === 'demo') await demo(args);
  else if (command === 'run') await runTask(args);
  else if (command === 'profile') await profile(args);
  else if (['help', '--help', '-h'].includes(command)) printHelp();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`\nDeepSeek Harness One: ${error.message}`);
  process.exitCode = 1;
}

async function serve(args) {
  const options = parseOptions(args);
  const config = loadConfig({
    host: options.host,
    port: options.port,
    demoMode: options.demo,
    openBrowser: options.open !== false,
    dataDir: options.dataDir,
  });
  const app = await createApplication(config);
  const address = await app.start();
  const runtime = await app.services.runtimeManager.status();
  console.log(`\nDeepSeek Harness One ${config.appVersion}`);
  console.log(`Control plane: ${address.url}`);
  console.log(`Runtime: ${runtime.active}${runtime.fallbackReason ? ` (${runtime.fallbackReason})` : ''}`);
  console.log(`Data: ${config.dataDir}\n`);

  if (config.openBrowser && options.open !== false) openBrowser(address.url);
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await app.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function doctor(args) {
  const config = loadConfig(parseOptions(args));
  const report = await runDoctor(config);
  for (const check of report.checks) {
    const mark = check.passed ? '✓' : check.optional ? '○' : '✗';
    console.log(`${mark} ${check.id}: ${check.detail}`);
    if (!check.passed && check.remediation) console.log(`  ${check.remediation}`);
  }
  if (!report.ok) process.exitCode = 1;
}

async function setup(args) {
  const config = loadConfig(parseOptions(args));
  const app = await createApplication({ ...config, openBrowser: false, demoMode: true });
  console.log(`Initialized DeepSeek Harness One at ${config.dataDir}`);
  console.log(`Demo workspace: ${app.services.workspaceService.get('ws_demo').path}`);
  await app.stop();
}

async function demo(args) {
  const options = parseOptions(args);
  const config = loadConfig({ ...options, demoMode: true, openBrowser: options.open !== false });
  const app = await createApplication(config);
  const address = await app.start();
  const task = await app.services.taskService.create({
    title: 'Explore DeepSeek Harness One',
    goal: 'Create an inspectable product brief explaining how durable tasks, memory, safety and verification work together.',
    workspaceId: 'ws_demo',
    mode: 'auto',
    autoRun: true,
  });
  console.log(`Demo: ${address.url}/#/tasks/${task.id}`);
  if (config.openBrowser) openBrowser(`${address.url}/#/tasks/${task.id}`);
  const shutdown = async () => app.stop();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runTask(args) {
  const options = parseOptions(args);
  const goal = options._.join(' ').trim();
  if (!goal) throw new Error('Usage: dsh-one run "task goal"');
  const config = loadConfig({ ...options, openBrowser: false });
  const app = await createApplication(config);
  const task = await app.services.taskService.create({ goal, title: options.title, workspaceId: options.workspace ?? 'ws_demo', mode: options.mode, autoRun: true });
  console.log(`Task ${task.id} queued.`);
  const completed = await app.services.taskService.waitForTerminal(task.id, { timeoutMs: Number(options.timeout ?? 600000) });
  console.log(completed.outputs.at(-1)?.content ?? completed.error?.message ?? completed.status);
  await app.stop();
  if (completed.status !== 'completed') process.exitCode = 1;
}

async function profile(args) {
  const options = parseOptions(args);
  const config = loadConfig(options);
  const service = new ExtensionService({
    config,
    registryFile: path.resolve(fileURLToPath(new URL('../config/integrations.json', import.meta.url))),
  });
  await service.init();
  const plan = buildRecommendedInstallPlan(service.registry);
  const markdown = formatInstallPlan(plan);
  if (options.output) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.resolve(options.output), markdown, 'utf8');
    console.log(`Wrote ${path.resolve(options.output)}`);
  } else console.log(markdown);
}

function parseOptions(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (rawKey.startsWith('no-')) {
      const positive = rawKey.slice(3).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[positive] = false;
    } else if (inline !== undefined) result[key] = inline;
    else if (args[index + 1] && !args[index + 1].startsWith('--')) result[key] = args[++index];
    else result[key] = true;
  }
  return result;
}

function openBrowser(url) {
  const commands = process.platform === 'darwin'
    ? [['open', [url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '', url]]]
      : [['xdg-open', [url]], ['gio', ['open', url]]];
  for (const [commandName, commandArgs] of commands) {
    try {
      const child = spawn(commandName, commandArgs, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return;
    } catch {}
  }
}

function printHelp() {
  console.log(`DeepSeek Harness One\n\nCommands:\n  serve [--host 127.0.0.1] [--port 3210] [--demo] [--no-open]\n  demo\n  run "goal" [--workspace ws_demo] [--mode auto]\n  doctor\n  setup\n  profile [--output install-plan.md]\n`);
}
