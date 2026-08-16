export const TASK_STATUSES = Object.freeze([
  'draft',
  'awaiting_approval',
  'queued',
  'running',
  'paused',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export function reduceTask(state, event) {
  if (!state && event.type !== 'task.created') return state;

  const updatedAt = event.timestamp;
  switch (event.type) {
    case 'task.created':
      return {
        id: event.entityId,
        title: event.payload.title,
        goal: event.payload.goal,
        workspaceId: event.payload.workspaceId,
        mode: event.payload.mode,
        status: 'draft',
        createdAt: event.timestamp,
        updatedAt,
        startedAt: null,
        completedAt: null,
        progress: 0,
        attempt: 0,
        activePhaseId: null,
        plan: [],
        acceptanceCriteria: event.payload.acceptanceCriteria ?? [],
        route: null,
        risk: event.payload.risk ?? { level: 'low', reasons: [] },
        approval: null,
        logs: [],
        outputs: [],
        artifacts: [],
        proof: null,
        memoryCandidateIds: [],
        error: null,
      };
    case 'task.plan.created':
      return withUpdate(state, updatedAt, {
        plan: event.payload.phases ?? [],
        acceptanceCriteria: event.payload.acceptanceCriteria ?? state.acceptanceCriteria,
      });
    case 'task.approval.required':
      return withUpdate(state, updatedAt, {
        status: 'awaiting_approval',
        approval: {
          required: true,
          reason: event.payload.reason,
          requestedAt: event.timestamp,
          approvedAt: null,
        },
      });
    case 'task.approved':
      return withUpdate(state, updatedAt, {
        approval: {
          ...(state.approval ?? {}),
          required: false,
          approvedAt: event.timestamp,
          approvedBy: event.payload.approvedBy ?? 'local-user',
        },
      });
    case 'task.retry.requested':
      return withUpdate(state, updatedAt, {
        status: 'draft',
        progress: 0,
        activePhaseId: null,
        completedAt: null,
        plan: state.plan.map((phase) => ({
          ...phase,
          status: 'pending',
          startedAt: null,
          completedAt: null,
        })),
        logs: [],
        outputs: [],
        artifacts: [],
        proof: null,
        memoryCandidateIds: [],
        error: null,
      });
    case 'task.queued':
      return withUpdate(state, updatedAt, { status: 'queued', progress: Math.max(state.progress, 1) });
    case 'task.started':
      return withUpdate(state, updatedAt, {
        status: 'running',
        startedAt: state.startedAt ?? event.timestamp,
        progress: Math.max(state.progress, 3),
        attempt: (state.attempt ?? 0) + 1,
        error: null,
      });
    case 'task.route.selected':
      return withUpdate(state, updatedAt, { route: event.payload });
    case 'task.phase.started':
      return withUpdate(state, updatedAt, {
        status: 'running',
        activePhaseId: event.payload.phaseId,
        progress: event.payload.progress ?? state.progress,
        plan: state.plan.map((phase) =>
          phase.id === event.payload.phaseId
            ? { ...phase, status: 'running', startedAt: event.timestamp }
            : phase,
        ),
      });
    case 'task.phase.completed':
      return withUpdate(state, updatedAt, {
        progress: event.payload.progress ?? state.progress,
        activePhaseId: null,
        plan: state.plan.map((phase) =>
          phase.id === event.payload.phaseId
            ? { ...phase, status: 'completed', completedAt: event.timestamp }
            : phase,
        ),
      });
    case 'task.log':
      return withUpdate(state, updatedAt, {
        logs: boundedPush(state.logs, {
          id: event.id,
          timestamp: event.timestamp,
          level: event.payload.level ?? 'info',
          message: event.payload.message,
          source: event.payload.source ?? 'runtime',
        }, 500),
      });
    case 'task.output':
      return withUpdate(state, updatedAt, {
        outputs: boundedPush(state.outputs, {
          id: event.id,
          timestamp: event.timestamp,
          kind: event.payload.kind ?? 'text',
          content: event.payload.content,
        }, 100),
      });
    case 'task.artifact.created':
      return withUpdate(state, updatedAt, {
        artifacts: [...state.artifacts, event.payload],
      });
    case 'task.verification.started':
      return withUpdate(state, updatedAt, { status: 'verifying', progress: Math.max(state.progress, 90) });
    case 'task.proof.completed':
      return withUpdate(state, updatedAt, { proof: event.payload });
    case 'task.memory.candidate':
      return withUpdate(state, updatedAt, {
        memoryCandidateIds: [...state.memoryCandidateIds, event.payload.candidateId],
      });
    case 'task.paused':
      return withUpdate(state, updatedAt, { status: 'paused' });
    case 'task.resumed':
      return withUpdate(state, updatedAt, { status: 'running' });
    case 'task.interrupted':
      return withUpdate(state, updatedAt, {
        status: 'interrupted',
        error: { message: event.payload.reason ?? 'The previous process stopped unexpectedly.' },
      });
    case 'task.completed':
      return withUpdate(state, updatedAt, {
        status: 'completed',
        progress: 100,
        activePhaseId: null,
        completedAt: event.timestamp,
      });
    case 'task.failed':
      return withUpdate(state, updatedAt, {
        status: 'failed',
        activePhaseId: null,
        completedAt: event.timestamp,
        error: event.payload.error ?? { message: 'Task failed.' },
      });
    case 'task.cancelled':
      return withUpdate(state, updatedAt, {
        status: 'cancelled',
        activePhaseId: null,
        completedAt: event.timestamp,
      });
    default:
      return state;
  }
}

export function replayTasks(events) {
  const tasks = new Map();
  for (const event of events) {
    if (!event.type.startsWith('task.')) continue;
    const next = reduceTask(tasks.get(event.entityId), event);
    if (next) tasks.set(event.entityId, next);
  }
  return tasks;
}

function withUpdate(state, updatedAt, patch) {
  return { ...state, ...patch, updatedAt };
}

function boundedPush(items, value, maximum) {
  const next = [...items, value];
  return next.length > maximum ? next.slice(next.length - maximum) : next;
}
