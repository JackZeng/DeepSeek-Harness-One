# ADR-0001: Keep the official DeepSeek Harness as the agent kernel

Status: accepted

## Context

The surrounding ecosystem contains several desktop shells, workspaces and agent orchestrators. Combining them by copying source into one repository would create overlapping loops, databases, plugin managers and model semantics.

The official Harness already defines replaceable model adapters, tools, sessions, approvals, jobs, subagents and the agent loop through Cordis composition.

## Decision

DeepSeek Harness One will not implement a competing agent loop. It treats the official `dsh` runtime as a replaceable execution provider behind a product-level task contract.

The One repository owns task durability and user experience. DSH owns in-session model and tool semantics.

## Consequences

Positive:

- Upstream fixes remain consumable.
- Plugin compatibility is preserved.
- One can improve its product surface without rewriting model infrastructure.
- Alternative runtimes can be added behind the same task contract.

Negative:

- Process-output integration is initially less rich than a native event bridge.
- Compatibility must be tested against DSH release candidates.
- Some product states require translation between One tasks and DSH sessions.

The roadmap therefore prioritizes a native official event bridge rather than a source fork.
