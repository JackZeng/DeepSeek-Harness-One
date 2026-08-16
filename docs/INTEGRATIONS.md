# Integration Guide

## Philosophy

One integrates upstream projects through their public package, profile, CLI or protocol boundary. It does not vendor their source code. This avoids a permanently diverging mega-fork and makes security updates independently consumable.

## Recommended default profile

### Official DeepSeek Harness

```bash
npx -y @deepseek-ai/dsh web
```

One uses a headless profile for durable task execution by default. Set `DSH_ONE_DSH_COMMAND` and `DSH_ONE_DSH_PROFILE` when your installation differs.

### Supervised memory — dsh-mnemon

```bash
dsh plugin --profile web add dsh-mnemon
```

The One control plane has its own lightweight approved memory for cross-task continuity. `dsh-mnemon` remains the richer in-session and cross-agent memory implementation. A future adapter will synchronize approved One candidates with an active Mnemon memory space instead of duplicating its database.

### Durable workflows

```bash
dsh plugin --profile web add github:dsh-external/dsh_workflow#main
```

One treats a task as a product-level durable object. The workflow plugin adds reusable, resumable multi-agent capsules inside DSH. The intended integration maps One task phases and artifacts to workflow run events.

### Tier router

```bash
dsh plugin --profile web add github:BruceLanLan/dsh-tier-router
```

The router is an agent-plane plugin and also requires its tiered agent preset. Follow its upstream installation guide. One's `fast / auto / deep` mode is a product policy; the plugin is the in-loop enforcement layer.

### Independent proof

```bash
dsh plugin --profile headless add github:EvilIrving/dsh-proof
```

One performs deterministic delivery checks. `dsh-proof` adds a read-only verifier at DSH's `agent/turn-stopping` seam. Both layers are complementary.

### OpenGuardrails

```bash
dsh plugin --profile web add @openguardrails/dsh
```

Configure the OpenGuardrails runtime separately. One does not bundle or impersonate a detector service.

### Local security audit

```bash
dsh plugin --profile web add github:omdsh-dev/dsh-security-audit
```

One's built-in scan is deliberately bounded and simple. The upstream audit plugin performs the deeper DSH-specific inspection.

### Extension market

```bash
dsh plugin --profile web add dshmarket
```

One displays a curated high-level catalog. The market remains responsible for the actual DSH plugin lifecycle and source validation.

### Vision bridge

```bash
dsh plugin --profile web add @liustack/modlens
```

One does not expose “vision wrapper” as a user mode. Image capability should be automatically routed by the runtime.

## Optional packs

### Team Mission Control — AgentRQ

```bash
dsh plugin --profile agentrq-<workspace> add @agentrq/dsh-plugin-agentrq
```

Use one upstream profile per AgentRQ workspace according to its current contract. The long-term One design is a native multi-workspace task and approval projection rather than exposing profiles to ordinary users.

### Enterprise Data — Mirage

```bash
npm install @struktoai/mirage-node @struktoai/mirage-agents
```

Mirage should be deployed with explicit credentials, mount policy and organization audit. It is not enabled in the personal default.

### Artifact Studio — Open Design

Install Open Design and run:

```bash
od agent setup deepseek-harness
```

The desired integration is an editable artifact surface and Studio workspace type, not a second overlapping home screen.

### Engineering Quality — Archify and Brooks Lint

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0
```

Install Brooks Lint as a DSH-compatible Skill from its upstream repository. Together they form a high-quality repository understanding and review workflow.

## Generate an install plan

```bash
npm run profile -- --output install-plan.md
```

Automatic installation is disabled by default. Set `DSH_ONE_ALLOW_EXTENSION_INSTALL=true` only on a trusted local machine after reviewing the curated command and plugin permissions.
