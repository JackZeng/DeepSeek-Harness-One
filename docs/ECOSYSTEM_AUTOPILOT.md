# Ecosystem Autopilot

DeepSeek Harness One includes a guarded nightly workflow that studies the surrounding DeepSeek Harness ecosystem, extracts product-level traits, and integrates at most one bounded improvement per run without changing One's identity.

## Schedule

The workflow runs every day at **23:30 Asia/Manila**. The GitHub Actions schedule uses the IANA timezone directly:

```yaml
schedule:
  - cron: '30 23 * * *'
    timezone: 'Asia/Manila'
```

It can also be started manually from **Actions → Ecosystem Autopilot** in either `discover` or `evolve` mode.

## What it does

1. Searches GitHub for `dsh-plugin`, DeepSeek Harness and closely related Agent repositories.
2. Reads repository metadata and bounded README excerpts only. It never clones, installs or executes candidate code.
3. Scores candidates by DSH relevance, recency, community signal, license clarity, novelty and current One coverage.
4. Extracts all notable traits into `docs/ecosystem/latest.md` and a bounded 365-run JSONL ledger.
5. When an evolver model key is available, asks a conservative product-architecture pass to select at most one genuinely new trait.
6. Uses a separate builder pass to create a minimal independent implementation rather than copying upstream source.
7. Enforces protected paths, file and line budgets, no-new-dependency rules, unsafe-capability checks, secret scanning and mandatory tests for product-code changes.
8. Uses an independent read-only product review of the proposed diff.
9. Runs Node.js 22 and 24 validation plus a production Docker build.
10. Creates an isolated branch and pull request, then attempts a squash merge only after every gate succeeds.

## Product invariants

The automation is bound by `AGENTS.md`, `docs/PRODUCT_PRINCIPLES.md` and `docs/ARCHITECTURE.md`. In particular, it may not:

- add a second agent loop, hidden session database or model protocol;
- expose profiles, providers, bundles or plugin mechanics as new user concepts;
- replace the vocabulary of workspace, task, artifact and memory;
- weaken proof, approval, path containment, secret redaction or user-controlled memory;
- copy an upstream project into this repository;
- add npm dependencies or arbitrary extension execution;
- introduce new outbound network access, subprocess capability, dynamic code execution, external scripts, symlinks, binaries or submodules;
- modify its own workflow, policy, protected architecture documents, package metadata, security policy or license;
- change more than one product trait per run.

Candidate README content is treated as untrusted input and fenced from model instructions. A repository can inspire an abstract behavior, but upstream code, prose, branding and internal architecture remain upstream.

## Model configuration

Discovery and scoring require only the workflow's built-in `GITHUB_TOKEN`. Model-assisted selection and implementation require one repository secret:

- `DSH_ONE_EVOLVER_API_KEY` — preferred dedicated key;
- `DEEPSEEK_API_KEY` — supported fallback.

Optional repository variables:

- `DSH_ONE_EVOLVER_BASE_URL` — defaults to `https://api.deepseek.com`;
- `DSH_ONE_EVOLVER_MODEL` — defaults to `deepseek-v4-pro`.

The endpoint must expose an OpenAI-compatible `/chat/completions` interface. Without a model key, the workflow still performs discovery, scoring, reporting and state tracking, but does not generate source changes. This is an intentional fail-safe mode.

## Manual runs

From **Actions → Ecosystem Autopilot → Run workflow**:

- `discover` performs read-only discovery and updates the report;
- `evolve` allows one guarded integration when a model key exists;
- `candidate` optionally pins an exact `owner/repository` from the eligible results;
- `merge` controls whether the validated pull request is merged automatically.

## Audit trail

- `docs/ecosystem/latest.md` contains the latest ranked findings and decision.
- `docs/ecosystem/ledger.jsonl` stores the last 365 run summaries.
- `config/ecosystem-autopilot-state.json` tracks recently seen and integrated repositories.
- Every successful run is represented by an isolated branch, a pull request and a squash commit.
- Every run uploads the proposed patch and report as a 30-day Actions artifact.
- A failed run creates an issue with the run URL and removes its temporary branch when possible.

## Operational notes

GitHub scheduled workflows execute from the default branch. In public repositories, GitHub may disable a scheduled workflow after a long period of repository inactivity; any normal repository activity or an edit to the schedule reactivates it.

The workflow is deliberately conservative. “No safe trait to integrate today” is a successful outcome, not a failure.
