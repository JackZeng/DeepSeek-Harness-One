# Deployment

## Local desktop-style use

```bash
npm start
```

The server starts on `127.0.0.1:3210` and opens the default browser. Install the PWA from a Chromium-based browser for a standalone app window.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DSH_ONE_HOST` | `127.0.0.1` | HTTP listen address |
| `DSH_ONE_PORT` | `3210` | HTTP port |
| `DSH_ONE_DATA_DIR` | `~/.dsh-one` | One state and artifacts |
| `DSH_ONE_DSH_COMMAND` | `dsh` | Official launcher command |
| `DSH_ONE_DSH_PROFILE` | `headless` | Profile used for durable tasks |
| `DSH_HOME` | `~/.dsh` | Official DSH home |
| `DSH_ONE_DEMO` | `false` | Force offline demo runtime |
| `DSH_ONE_CONCURRENCY` | `2` | Concurrent task limit, maximum 8 |
| `DSH_ONE_ALLOW_EXTENSION_INSTALL` | `false` | Permit curated plugin installs |
| `DSH_ONE_PROOF_STRICT` | `true` | Require an artifact for completion |

## Docker

The base image runs One in demo/fallback mode unless a `dsh` executable and its profile state are added to the container.

```bash
docker compose up --build
```

The compose file exposes the app only on the host loopback interface.

## systemd user service

Copy `deploy/systemd/deepseek-harness-one.service` to:

```text
~/.config/systemd/user/deepseek-harness-one.service
```

Edit the working directory, then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now deepseek-harness-one
```

## Reverse proxy

Only expose One after adding authentication. A safe deployment should include:

- HTTPS.
- Identity-aware authentication.
- CSRF protection for state-changing routes.
- Per-user data directories and workspace ACLs.
- Request and SSE connection limits.
- Audit logging that does not contain secrets.
- An explicit OpenGuardrails fail mode.

Version 0.1 is not a hosted multi-tenant service.
