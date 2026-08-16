import { sleep } from '../core/utils.mjs';

export class DemoRuntime {
  constructor({ artifactService, delayMs = 260 }) {
    this.artifactService = artifactService;
    this.delayMs = delayMs;
    this.paused = new Map();
  }

  async status() {
    return {
      id: 'demo',
      available: true,
      mode: 'demo',
      label: 'Built-in demonstration runtime',
      detail: 'No external model call is made.',
    };
  }

  async execute({ task, workspace, route, memory, signal, onLog, onOutput }) {
    const steps = [
      `Reading the goal and ${memory.length} relevant memory item(s).`,
      `Using ${route.execution.tier} execution tier under ${route.mode} mode.`,
      `Inspecting workspace: ${workspace.name}.`,
      'Producing a concrete, inspectable delivery artifact.',
    ];
    for (const message of steps) {
      await this.#waitIfPaused(task.id, signal);
      await onLog({ level: 'info', message, source: 'demo-runtime' });
      await sleep(this.delayMs, signal);
    }

    const finalOutput = [
      `Completed “${task.title}” in the demonstration runtime.`,
      '',
      'The control plane exercised planning, routing, execution, verification, artifact delivery and memory suggestion without sending data to an external model.',
      '',
      'Install the official DeepSeek Harness and switch off demo mode to execute this same task through `dsh --profile headless`.',
    ].join('\n');
    await onOutput({ kind: 'text', content: finalOutput });

    const artifact = await this.artifactService.createText(task.id, {
      name: 'delivery.md',
      content: [
        `# ${task.title}`,
        '',
        '## Goal',
        '',
        task.goal,
        '',
        '## Execution route',
        '',
        `- Mode: ${route.mode}`,
        `- Planning tier: ${route.planning.tier}`,
        `- Execution tier: ${route.execution.tier}`,
        `- Review tier: ${route.review.tier}`,
        '',
        '## Result',
        '',
        finalOutput,
      ].join('\n'),
    });

    return { success: true, exitCode: 0, finalOutput, artifacts: [artifact], runtime: 'demo' };
  }

  async pause(taskId) {
    this.paused.set(taskId, true);
    return true;
  }

  async resume(taskId) {
    this.paused.set(taskId, false);
    return true;
  }

  async cancel(taskId) {
    this.paused.delete(taskId);
    return true;
  }

  async #waitIfPaused(taskId, signal) {
    while (this.paused.get(taskId)) await sleep(80, signal);
  }
}
