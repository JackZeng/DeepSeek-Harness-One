export class RuntimeManager {
  constructor({ config, dshRuntime, demoRuntime }) {
    this.config = config;
    this.dshRuntime = dshRuntime;
    this.demoRuntime = demoRuntime;
    this.taskRuntime = new Map();
  }

  async status() {
    const dsh = await this.dshRuntime.status();
    const demo = await this.demoRuntime.status();
    const active = this.config.demoMode || !dsh.available ? demo : dsh;
    return { active: active.id, runtimes: [dsh, demo], fallbackReason: dsh.available ? null : dsh.detail };
  }

  async execute(context) {
    const status = await this.dshRuntime.status();
    const runtime = this.config.demoMode || !status.available ? this.demoRuntime : this.dshRuntime;
    this.taskRuntime.set(context.task.id, runtime);
    try {
      return await runtime.execute(context);
    } finally {
      this.taskRuntime.delete(context.task.id);
    }
  }

  async pause(taskId) {
    return this.taskRuntime.get(taskId)?.pause(taskId) ?? false;
  }

  async resume(taskId) {
    return this.taskRuntime.get(taskId)?.resume(taskId) ?? false;
  }

  async cancel(taskId) {
    return this.taskRuntime.get(taskId)?.cancel(taskId) ?? false;
  }
}
