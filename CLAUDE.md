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
  api.ts       — Fetch wrapper (base URL, auth headers, JSON/text responses)
  config.ts    — .draftmark.json read/write, slug/apiKey/magicToken resolution
  format.ts    — ANSI color helpers, label formatting, comment formatting
```

Four files. Keep it that way — no unnecessary abstractions.

## Architecture Decisions

- **Single entry point:** All commands defined in `cli.ts`. Don't split into separate command files unless there are 20+ commands.
- **Config resolution:** CLI flag > env var > `.draftmark.json`. This order is intentional — flags for one-off overrides, env vars for CI, config file for project context.
- **Output convention:** `stderr` for status messages (creating, fetching...), `stdout` for data (URLs, JSON, raw markdown). This makes piping work: `dm raw | head`.
- **No dependencies beyond Commander:** Use built-in `fetch`, `fs`, `path`. Don't add axios, chalk, ora, or similar.
- **ANSI colors:** Implemented manually in `format.ts` (6 colors + reset). No chalk dependency.

## API Reference

The Draftmark API spec lives in the main repo: `draftmark-app/draftmark/openapi.yaml`

Base URL: `https://draftmark.app/api/v1` (override with `DM_BASE_URL` env var).

### Auth model

| Token | Prefix | Use |
|-------|--------|-----|
| Doc API Key | `key_` | Read private docs, list comments |
| Magic Token | _(none)_ | Owner operations (update, close, delete) |
| Account API Key | `acct_` | Account-level operations |

### Key endpoints used by the CLI

- `POST /docs` — create doc
- `GET /docs/:slug` — get doc (with `?format=raw` for markdown)
- `PATCH /docs/:slug` — update status (requires magic token)
- `DELETE /docs/:slug` — delete (requires magic token)
- `GET /docs/:slug/comments` — list comments
- `POST /docs/:slug/comments` — add comment
- `POST /docs/:slug/reviews` — mark reviewed

## Commands

| Command | API Call | Auth |
|---------|----------|------|
| `dm create <file>` | POST /docs | None |
| `dm status [slug]` | GET /docs/:slug | api_key |
| `dm comments [slug]` | GET /docs/:slug/comments | api_key |
| `dm comment [slug] <body>` | POST /docs/:slug/comments | api_key |
| `dm review [slug]` | POST /docs/:slug/reviews | api_key |
| `dm raw [slug]` | GET /docs/:slug?format=raw | api_key |
| `dm close [slug]` | PATCH /docs/:slug | magic_token |
| `dm open [slug]` | PATCH /docs/:slug | magic_token |
| `dm delete [slug]` | DELETE /docs/:slug | magic_token |

## Testing

No test framework yet. To manually test:

```bash
# Create a test doc
echo "# Test" | dm create /dev/stdin

# Check it
dm status
dm comments
dm raw

# Clean up
dm delete --confirm
```

## Publishing

```bash
npm version patch
npm publish
```

`prepublishOnly` runs `tsc` automatically.
