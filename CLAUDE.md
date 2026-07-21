---
tags:
  - TypeScript
  - CLI
  - markdown
  - REST API
  - ESM modules
projects:
  - Draftmark
  - Rumbo Labs
tools:
  - Commander.js
  - npm
  - GitHub Actions
  - Node.js
---
# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`dm` is the CLI for [Draftmark](https://draftmark.app) — a markdown sharing platform for async collaboration between humans and AI agents. It wraps the Draftmark REST API for terminal and agent use.

Part of [Rumbo Labs](https://github.com/draftmark-app) alongside the main Draftmark app.

## Tech Stack

- **Language:** TypeScript (ESM)
- **CLI framework:** Commander.js
- **HTTP:** Built-in `fetch` (Node 18+)
- **Build:** `tsc` → `dist/`
- **Package:** `draftmark` on npm, binary is `dm`
- **Publish:** GitHub release triggers `npm publish` via Actions workflow

## Dev Workflow

```bash
npm install
npm run build          # Compile TypeScript
npm run dev            # Watch mode (tsc --watch)
npm link               # Install globally for local testing
dm --help              # Verify it works
```

## Project Structure

```
src/
  cli.ts       — Entry point, commander setup, all command definitions
  api.ts       — Fetch wrapper (base URL, auth headers, structured error normalization)
  config.ts    — Local (.draftmark.json) + global (~/.config/draftmark/config.json) config, resolution helpers
  format.ts    — ANSI color helpers, label/table/comment formatting, quiet mode
```

Four files. Keep it that way — no unnecessary abstractions.

## Architecture Decisions

- **Single entry point:** All commands defined in `cli.ts`. Don't split into separate command files unless there are 20+ commands.
- **Config resolution:** CLI flag → env var → `.draftmark.json` → global config (`~/.config/draftmark/config.json`). This order is intentional — flags for one-off overrides, env vars for CI, local config for project context, global for account-wide defaults.
- **Output convention:** `stderr` for status messages (creating, fetching...), `stdout` for data (URLs, JSON, raw markdown). This makes piping work: `dm raw | head`. The `--quiet` flag suppresses all stderr.
- **Structured errors:** All API errors are normalized to `{ error, code, details }` in `api.ts`. Commands use `fail()` helper for consistent exit codes.
- **Exit codes:** 0 ok, 1 general error, 2 auth (401/403), 3 not found (404), 4 conflict (409).
- **No dependencies beyond Commander:** Use built-in `fetch`, `fs`, `path`, `os`, `child_process`. Don't add axios, chalk, ora, or similar.
- **ANSI colors:** Implemented manually in `format.ts` (6 colors + reset). No chalk dependency.

## API Reference

The Draftmark API spec lives in the main repo: `draftmark-app/draftmark/openapi.yaml`

Base URL: `https://draftmark.app/api/v1` (override with `--base-url` flag or `DM_BASE_URL` env var).

### Auth model

| Token | Prefix | Use |
|-------|--------|-----|
| Doc API Key | `key_` | Read private docs, list comments |
| Magic Token | _(none)_ | Owner operations (update, close, delete) |
| Account API Key | `acct_` | Account-level operations (create private docs) |

### Key endpoints used by the CLI

- `POST /docs` — create doc (optional `Authorization` header for private docs)
- `GET /docs/:slug` — get doc (with `?format=raw` for markdown)
- `PATCH /docs/:slug` — update content/status (requires magic token)
- `DELETE /docs/:slug` — delete (requires magic token)
- `GET /docs/:slug/comments` — list comments
- `POST /docs/:slug/comments` — add comment
- `POST /docs/:slug/reactions` — add reaction
- `POST /docs/:slug/reviews` — mark reviewed

## Commands

| Command | API Call | Auth |
|---------|----------|------|
| `dm create <file>` | POST /docs | api_key (required for --private) |
| `dm update <file> [slug]` | PATCH /docs/:slug | magic_token |
| `dm status [slug]` | GET /docs/:slug | api_key |
| `dm comments [slug]` | GET /docs/:slug/comments | api_key |
| `dm comment [slug] <body>` | POST /docs/:slug/comments | api_key |
| `dm react [slug] <emoji>` | POST /docs/:slug/reactions | api_key |
| `dm review [slug]` | POST /docs/:slug/reviews | api_key |
| `dm raw [slug]` | GET /docs/:slug?format=raw | api_key |
| `dm close [slug]` | PATCH /docs/:slug | magic_token |
| `dm open [slug]` | PATCH /docs/:slug | magic_token |
| `dm delete [slug]` | DELETE /docs/:slug | magic_token |
| `dm browse [slug]` | _(local)_ | none |
| `dm list` | _(local)_ | none |
| `dm login` | _(local)_ | none |
| `dm logout` | _(local)_ | none |
| `dm whoami` | _(local)_ | none |
| `dm config` | _(local)_ | none |

## Testing

No test framework yet. To manually test:

```bash
# Create a test doc
echo "# Test" | dm create -

# Check it
dm status
dm comments
dm raw

# Clean up
dm delete --confirm
```

## Publishing

Create a GitHub release — the Actions workflow handles `npm publish`:

```bash
gh release create v0.x.0 --repo draftmark-app/cli --title "v0.x.0" --notes "..."
```
