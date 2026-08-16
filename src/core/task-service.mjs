import { createId, normalizeWhitespace, sleep, sortByDateDescending, toErrorPayload } from './utils.mjs';
import { reduceTask, replayTasks } from './task-reducer.mjs';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const RERUNNABLE_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);

export class TaskService {
  constructor({
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
    concurrency = 2,
  }) {
    this.eventStore = eventStore;
    this.planner = planner;
    this.modelRouter = modelRouter;
    this.securityService = securityService;
    this.memoryService = memoryService;
    this.workspaceService = workspaceService;
    this.artifactService = artifactService;
    this.proofService = proofService;
    this.runtimeManager = runtimeManager;
    this.settingsService = settingsService;
    this.concurrency = concurrency;
    this.tasks = new Map();
    this.queue = [];
    this.active = new Map();
    this.listeners = new Set();
    this.stopping = false;
  }

  async init() {
    const events = await this.eventStore.readAll();
    this.tasks = replayTasks(events);
    this.eventStore.subscribe((event) => {
      if (!event.type.startsWith('task.')) return;
      const task = reduceTask(this.tasks.get(event.entityId), event);
      if (task) this.tasks.set(event.entityId, task);
      for (const listener of this.listeners) {
        try {
          listener({ event, task: task ? structuredClone(task) : null });
        } catch (error) {
          console.error('[task-service] listener failed:', error);
        }
      }
    });

    // The in-memory queue and child-process handles cannot survive a restart.
    // Make that loss explicit instead of leaving tasks visually stuck in “running” or “queued”.
    for (const task of [...this.tasks.values()]) {
      if (['queued', 'running', 'paused', 'verifying'].includes(task.status)) {
        await this.#append('task.interrupted', task.id, {
          reason: 'The application restarted before this task reached a terminal result. Run it again to continue.',
        });
      }
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list({ status, workspaceId, limit = 100 } = {}) {
    return sortByDateDescending([...this.tasks.values()])
      .filter((task) => !status || task.status === status)
      .filter((task) => !workspaceId || task.workspaceId === workspaceId)
      .slice(0, limit)
      .map((task) => structuredClone(task));
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }

  async create({ title, goal, workspaceId = 'ws_demo', mode, acceptanceCriteria = [], autoRun }) {
    if (this.stopping) throw new Error('The application is shutting down and cannot accept a new task.');
    const normalizedGoal = normalizeWhitespace(goal);
    if (normalizedGoal.length < 3) throw new TypeError('Task goal must contain at least 3 characters.');
    const workspace = this.workspaceService.get(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');

    const settings = this.settingsService.get();
    const selectedMode = ['fast', 'auto', 'deep'].includes(mode) ? mode : settings.defaultMode;
    const risk = settings.guardrails ? this.securityService.classifyGoal(normalizedGoal) : { level: 'low', reasons: [] };
    const taskId = createId('task');
    const taskTitle = normalizeWhitespace(title || deriveTitle(normalizedGoal)).slice(0, 120);
    const plan = this.planner.createPlan({ goal: normalizedGoal, acceptanceCriteria });

    await this.#append('task.created', taskId, {
      title: taskTitle,
      goal: normalizedGoal,
      workspaceId,
      mode: selectedMode,
      acceptanceCriteria: plan.acceptanceCriteria,
      risk,
    });
    await this.#append('task.plan.created', taskId, plan);

    if (risk.level === 'high') {
      await this.#append('task.approval.required', taskId, {
        reason: `This task includes high-impact signals: ${risk.reasons.join(', ')}.`,
      });
    } else if (autoRun ?? settings.autoRunTasks) {
      await this.enqueue(taskId);
    }

    await this.workspaceService.touch(workspaceId);
    return this.get(taskId);
  }

  async enqueue(taskId) {
    if (this.stopping) throw new Error('The application is shutting down and cannot queue work.');
    const task = this.#requireTask(taskId);
    if (task.status === 'awaiting_approval') throw new Error('Approve this high-impact task before running it.');
    if (task.status === 'completed') throw new Error('A completed task is immutable. Create a follow-up task instead.');
    if (TERMINAL_STATUSES.has(task.status) && !RERUNNABLE_STATUSES.has(task.status)) {
      throw new Error(`Cannot queue a ${task.status} task.`);
    }
    if (this.queue.includes(taskId) || this.active.has(taskId)) return this.get(taskId);
    await this.#append('task.queued', taskId, {});
    this.queue.push(taskId);
    this.#pump();
    return this.get(taskId);
  }

  async action(taskId, action, payload = {}) {
    const task = this.#requireTask(taskId);
    switch (action) {
      case 'approve':
        if (task.status !== 'awaiting_approval') throw new Error('Task is not waiting for approval.');
        await this.#append('task.approved', taskId, { approvedBy: payload.approvedBy ?? 'local-user' });
        return this.enqueue(taskId);
      case 'start':
        return this.enqueue(taskId);
      case 'retry':
      case 'resume-run':
        if (!RERUNNABLE_STATUSES.has(task.status)) throw new Error(`A ${task.status} task cannot be run again.`);
        await this.#append('task.retry.requested', taskId, { previousStatus: task.status });
        return this.enqueue(taskId);
      case 'pause': {
        const control = this.active.get(taskId);
        if (!control) throw new Error('Only an active task can be paused.');
        if (control.paused) return this.get(taskId);
        control.paused = true;
        await this.runtimeManager.pause(taskId);
        await this.#append('task.paused', taskId, {});
        return this.get(taskId);
      }
      case 'resume': {
        const control = this.active.get(taskId);
        if (!control) throw new Error('This task is no longer active. Run it again instead.');
        control.paused = false;
        await this.runtimeManager.resume(taskId);
        await this.#append('task.resumed', taskId, {});
        return this.get(taskId);
      }
      case 'cancel': {
        const wasQueued = this.queue.includes(taskId);
        this.queue = this.queue.filter((id) => id !== taskId);
        const control = this.active.get(taskId);
        if (control) {
          control.cancelledByUser = true;
          control.controller.abort(new DOMException('Cancelled by user', 'AbortError'));
          await this.runtimeManager.cancel(taskId);
        } else if (wasQueued && !TERMINAL_STATUSES.has(task.status)) {
          await this.#append('task.cancelled', taskId, {});
        } else if (!wasQueued && !TERMINAL_STATUSES.has(task.status)) {
          await this.#append('task.cancelled', taskId, {});
        }
        return this.get(taskId);
      }
      default:
        throw new TypeError(`Unknown task action: ${action}`);
    }
  }

  async waitForTerminal(taskId, { timeoutMs = 120000 } = {}) {
    const initial = this.#requireTask(taskId);
    if (TERMINAL_STATUSES.has(initial.status)) return initial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for task ${taskId}.`));
      }, timeoutMs);
      const unsubscribe = this.subscribe(({ task }) => {
        if (task?.id === taskId && TERMINAL_STATUSES.has(task.status)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(task);
        }
      });
    });
  }

  async shutdown({ timeoutMs = 5000 } = {}) {
    if (this.stopping) return;
    this.stopping = true;

    const queued = [...this.queue];
    this.queue = [];
    for (const taskId of queued) {
      const task = this.tasks.get(taskId);
      if (task && !TERMINAL_STATUSES.has(task.status)) {
        await this.#append('task.interrupted', taskId, { reason: 'The application stopped before this queued task started.' });
      }
    }

    const controls = [...this.active.entries()];
    for (const [taskId, control] of controls) {
      control.shuttingDown = true;
      if (!control.controller.signal.aborted) {
        control.controller.abort(new DOMException('Application shutting down', 'AbortError'));
      }
      await this.runtimeManager.cancel(taskId).catch(() => false);
    }

    const pending = controls.map(([, control]) => control.promise).filter(Boolean);
    if (pending.length > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  }

  #pump() {
    if (this.stopping) return;
    while (this.active.size < this.concurrency && this.queue.length > 0) {
      const taskId = this.queue.shift();
      if (!taskId || this.active.has(taskId)) continue;
      const controller = new AbortController();
      const control = {
        controller,
        paused: false,
        shuttingDown: false,
        cancelledByUser: false,
        promise: null,
      };
      this.active.set(taskId, control);
      control.promise = this.#runTask(taskId, control)
        .catch((error) => console.error(`[task-service] ${taskId} failed:`, error))
        .finally(() => {
          this.active.delete(taskId);
          this.#pump();
        });
    }
  }

  async #runTask(taskId, control) {
    let task = this.#requireTask(taskId);
    const workspace = this.workspaceService.get(task.workspaceId);
    if (!workspace) {
      await this.#append('task.failed', taskId, { error: { message: 'Workspace no longer exists.' } });
      return;
    }

    try {
      await this.#append('task.started', taskId, {});
      task = this.#requireTask(taskId);
      const route = this.modelRouter.route({ goal: task.goal, mode: task.mode, risk: task.risk });
      await this.#append('task.route.selected', taskId, route);
      const recalledMemory = await this.memoryService.recall(task.goal, { workspaceId: task.workspaceId, limit: 6 });
      await this.#append('task.log', taskId, {
        level: 'info',
        source: 'memory',
        message: recalledMemory.length > 0
          ? `Recalled ${recalledMemory.length} approved memory item(s).`
          : 'No approved memory was needed for this task.',
      });

      let runtimeResult = null;
      const phases = this.#requireTask(taskId).plan;
      for (let index = 0; index < phases.length; index += 1) {
        await waitWhilePaused(control);
        if (control.controller.signal.aborted) throw control.controller.signal.reason;
        const phase = phases[index];
        const startingProgress = Math.round(5 + (index / phases.length) * 78);
        await this.#append('task.phase.started', taskId, { phaseId: phase.id, progress: startingProgress });
        await this.#append('task.log', taskId, { level: 'info', source: 'orchestrator', message: phase.description });

        if (index === Math.min(2, phases.length - 1)) {
          runtimeResult = await this.runtimeManager.execute({
            task: this.#requireTask(taskId),
            workspace,
            route,
            memory: recalledMemory,
            signal: control.controller.signal,
            onLog: (entry) => this.#append('task.log', taskId, entry),
            onOutput: (entry) => this.#append('task.output', taskId, entry),
          });
          for (const artifact of runtimeResult.artifacts ?? []) {
            await this.#append('task.artifact.created', taskId, artifact);
          }
        } else {
          await sleep(80, control.controller.signal);
        }

        const completedProgress = Math.round(5 + ((index + 1) / phases.length) * 82);
        await this.#append('task.phase.completed', taskId, { phaseId: phase.id, progress: completedProgress });
      }

      await waitWhilePaused(control);
      if (control.controller.signal.aborted) throw control.controller.signal.reason;
      runtimeResult ??= { success: false, exitCode: 1, finalOutput: '', artifacts: [], runtime: 'none' };
      await this.#append('task.verification.started', taskId, {});
      const securityStatus = await this.securityService.scan({ workspacePaths: [workspace.path] });
      const proof = await this.proofService.verify({
        task: this.#requireTask(taskId),
        runtimeResult,
        workspace,
        artifacts: this.#requireTask(taskId).artifacts,
        securityStatus,
      });
      await this.#append('task.proof.completed', taskId, proof);

      if (proof.verdict !== 'pass') {
        await this.#append('task.failed', taskId, {
          error: { message: `Independent verification failed: ${proof.summary}` },
        });
        return;
      }

      if (this.settingsService.get().memorySuggestions) {
        const candidate = await this.memoryService.proposeFromTask(
          { ...this.#requireTask(taskId), status: 'completed' },
          workspace,
        );
        if (candidate) await this.#append('task.memory.candidate', taskId, { candidateId: candidate.id });
      }
      await this.#append('task.completed', taskId, {});
    } catch (error) {
      if (control.controller.signal.aborted || error?.name === 'AbortError') {
        const current = this.#requireTask(taskId);
        if (control.shuttingDown) {
          if (current.status !== 'interrupted') {
            await this.#append('task.interrupted', taskId, { reason: 'The application stopped while this task was active.' });
          }
        } else if (current.status !== 'cancelled') {
          await this.#append('task.cancelled', taskId, {});
        }
      } else {
        await this.#append('task.failed', taskId, { error: toErrorPayload(error) });
      }
    }
  }

  async #append(type, taskId, payload) {
    return this.eventStore.append(type, taskId, payload, { actor: 'dsh-one' });
  }

  #requireTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found.');
    return structuredClone(task);
  }
}

async function waitWhilePaused(control) {
  while (control.paused) {
    if (control.controller.signal.aborted) throw control.controller.signal.reason;
    await sleep(80, control.controller.signal);
  }
}

function deriveTitle(goal) {
  const firstSentence = goal.split(/[。.!?？\n]/)[0];
  return firstSentence.length > 70 ? `${firstSentence.slice(0, 67)}…` : firstSentence;
}
