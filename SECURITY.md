# Security Policy

## Supported versions

Until 1.0, only the latest commit on `main` and the latest tagged release receive security fixes.

## Reporting a vulnerability

Do not open a public issue containing exploit details, private workspace data, credentials or model transcripts.

Report the issue privately through GitHub Security Advisories for this repository. Include:

- Affected version or commit.
- Reproduction steps using non-sensitive data.
- Impact and trust boundary crossed.
- Suggested mitigation, when known.

## Scope

High-priority reports include:

- Path traversal or arbitrary file read/write outside registered roots.
- Remote command execution not requiring local user approval.
- Secret exposure through logs, memory, API or UI.
- Authentication bypass in a future remote/team deployment.
- Extension source substitution or permission bypass.
- A task shown as verified when required checks did not run.

The lack of multi-user authentication in version 0.1 is documented behavior; exposing the service publicly without a protective proxy is unsupported.
