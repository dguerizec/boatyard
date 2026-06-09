# Security Policy

## Supported Versions

Boatyard is early-stage software. Security fixes are expected to target the latest released version.

## Reporting a Vulnerability

Please report security issues privately by email to David Guerizec at `david@guerizec.net`.

Include enough detail to reproduce and assess the issue:

- Affected version or commit.
- Operating system.
- Steps to reproduce.
- Expected impact.
- Any relevant logs, screenshots, or proof of concept.

Please do not open a public issue for a vulnerability until it has been reviewed.

## Scope

Boatyard is a local Electron app for trusted development workflows. Reports are especially useful for issues involving:

- Exposure of local credentials or tokens.
- Unsafe handling of project paths, plugin settings, or persisted state.
- Unexpected command execution.
- Webview or preload isolation problems.
