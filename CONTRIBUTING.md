# Contributing

Thank you for helping make DeepSeek Harness One calmer, safer and more dependable.

## Before changing code

Read:

- `docs/PRODUCT_PRINCIPLES.md`
- `docs/ARCHITECTURE.md`
- `AGENTS.md`

Open an issue for changes that add a new top-level product concept, alter persistence, expose the service beyond loopback, or change an upstream integration boundary.

## Development

```bash
npm run dev
npm run check
npm test
```

No install step is required for the current repository because it has no runtime or development dependencies.

## Pull requests

A good pull request explains:

- The user problem.
- Why the change belongs in One instead of an upstream plugin.
- The contract or event affected.
- Security and recovery behavior.
- Tests and visual checks performed.

Keep unrelated refactors out of a feature change. Add migrations when persisted data changes.

## Commit style

Use short imperative subjects, for example:

```text
Add proof evidence for required files
Prevent workspace path escape
Refine task approval state
```
