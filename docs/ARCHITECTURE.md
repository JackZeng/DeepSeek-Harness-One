# Architecture

## System boundary

DeepSeek Harness One is a local control plane. It does not implement an alternative LLM protocol or agent loop. The official `dsh` CLI remains the primary execution runtime.

One owns:

- Workspace registration and selection.
- Durable task lifecycle and queueing.
- User-visible plans, progress and approvals.
- Cross-task memory candidates and local state.
- Artifact collection and preview.
- Product-level verification and security posture.
- Curated integration metadata.

DeepSeek Harness owns:

- Model adapters and provider calls.
- Model-visible session history.
- Tool schema assembly and execution.
- Sandbox, filesystem and subprocess providers.
- In-session approval policy.
- Subagents, jobs and agent-loop semantics.

## Runtime topology

```text
Browser / CLI
      |
      v
Node HTTP Control Plane
      |
      +-- WorkspaceService
      +-- TaskService ------ EventStore (JSONL)
      |       |                   |
      |       +-- Planner         +--> SSE live projection
      |       +-- ModelRouter
      |       +-- MemoryService
      |       +-- SecurityService
      |       +-- RuntimeManager --+--> DshRuntime -> dsh --profile headless
      |       |                    +--> DemoRuntime
      |       +-- ProofService
      |       +-- ArtifactService
      |
      +-- ExtensionService -> curated integration registry
```

## Task event model

Task state is a projection of append-only events. Representative events:

```text
task.created
task.plan.created
task.approval.required
task.approved
task.queued
task.started
task.route.selected
task.phase.started
task.log
task.output
task.artifact.created
task.phase.completed
task.verification.started
task.proof.completed
task.memory.candidate
task.completed | task.failed | task.cancelled
```

The event file is newline-delimited JSON. Writes are serialized and atomic at the append boundary. On boot, projections are rebuilt from the log. Tasks left active by a process restart become `interrupted` rather than silently appearing complete.

## Execution contract

For a real DSH task, One constructs a bounded task contract containing:

- Goal and selected workspace.
- Approved recalled memory.
- User mode and route tiers.
- Observable plan.
- Acceptance criteria.
- Delivery manifest location.
- Requirements to check work before completion.

It then spawns the configured command without a shell:

```text
<DSH_ONE_DSH_COMMAND> --profile <DSH_ONE_DSH_PROFILE> <task-contract>
```

Standard output becomes the final text result. One asks the runtime to write a delivery manifest for workspace artifacts and always records a local transcript artifact.

## Memory model

The local implementation mirrors the intended three-level product model:

- `hot` — compact preferences and active collaboration rules.
- `documents` — managed project knowledge and narrative records.
- `spaces` — durable cross-session facts and relationships.
- `candidates` — proposed entries that have not been approved.

Memory is not injected blindly by One into arbitrary tools. Recall is bounded, workspace-aware and passed to the DSH task contract as approved context.

## Proof model

Version 0.1 performs deterministic product-level checks:

- Runtime success.
- Non-empty final output.
- Terminal plan phases.
- At least one artifact in strict mode.
- Explicit `file:<relative-path>` criteria.
- Non-blocking local security observation.

The recommended production profile additionally installs `dsh-proof`, allowing an independent read-only agent to challenge completion inside DSH before the turn closes.

## Security boundaries

- Server defaults to loopback.
- JSON request bodies are limited to 1 MiB.
- Static and artifact paths are containment-checked.
- Processes are spawned with argument arrays and `shell: false`.
- Event payloads are redacted before persistence.
- Memory rejects apparent secrets.
- Extension installation is disabled by default.
- Local scans are bounded and do not execute inspected code.

## Why no frontend framework

The control plane has no runtime npm dependencies. The PWA uses standards-based HTML, CSS, modules, Fetch, EventSource and Service Workers. This keeps initial installation deterministic and lets the repository start even before the official DSH package is installed.

A future native desktop wrapper can host the same local API and web assets without changing domain contracts.
