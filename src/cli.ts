#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { Command } from "commander";
import { api } from "./api.js";
import {
  appendConfig,
  getBaseUrl,
  getLastEntry,
  getShareBaseUrl,
  readConfig,
  readGlobalConfig,
  resolveAccountApiKey,
  resolveApiKey,
  resolveApiKeyOptional,
  resolveMagicToken,
  resolveSlug,
  setBaseUrl,
  writeGlobalConfig,
} from "./config.js";
import {
  bold,
  cyan,
  dim,
  error,
  formatComment,
  formatCommentMinimal,
  formatStatusMinimal,
  formatTable,
  green,
  info,
  label,
  printJson,
  setQuiet,
  success,
  yellow,
  type Comment,
} from "./format.js";

// ---------------------------------------------------------------------------
// Exit codes (0 = ok, 1 = general error, 2 = auth, 3 = not found, 4 = conflict)
// ---------------------------------------------------------------------------

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_AUTH = 2;
const EXIT_NOT_FOUND = 3;
const EXIT_CONFLICT = 4;

function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT_AUTH;
  if (status === 404) return EXIT_NOT_FOUND;
  if (status === 409) return EXIT_CONFLICT;
  return EXIT_ERROR;
}

/** Print error + structured JSON, then exit with status-appropriate code */
function fail(message: string, status: number, data?: unknown): never {
  error(`${message} (${status})`);
  if (data) printJson(data);
  process.exit(exitCodeForStatus(status));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readContentFromFileOrStdin(file: string): Promise<string> {
  if (file === "-") {
    return readStdin();
  }
  try {
    return await readFile(file, "utf-8");
  } catch {
    error(`Could not read file: ${file}`);
    process.exit(EXIT_ERROR);
  }
}

/** Resolve the output format — --json is sugar for --format json */
function resolveFormat(opts: { json?: boolean; format?: string }): string {
  if (opts.format) return opts.format;
  if (opts.json) return "json";
  return "table";
}

function openInBrowser(url: string): void {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync(`open ${JSON.stringify(url)}`);
    } else if (os === "win32") {
      execSync(`start "" ${JSON.stringify(url)}`);
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`);
    }
  } catch {
    error("Could not open browser. URL:");
    process.stdout.write(url + "\n");
  }
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("dm")
  .description("CLI for Draftmark — markdown sharing for async collaboration")
  .version("0.2.1")
  .option("-q, --quiet", "Suppress all stderr output")
  .option("--base-url <url>", "Override API base URL (default: https://draftmark.app/api/v1)");

// Apply global options before every command
program.hook("preAction", () => {
  const opts = program.opts();
  if (opts.quiet) setQuiet(true);
  if (opts.baseUrl) setBaseUrl(opts.baseUrl);
});

// ---------------------------------------------------------------------------
// dm create <file>
// ---------------------------------------------------------------------------
program
  .command("create")
  .description("Create a new document from a markdown file (use - for stdin)")
  .argument("<file>", 'Path to a markdown file, or "-" to read from stdin')
  .option("--private", "Create as private (magic link only)")
  .option("--title <title>", "Document title")
  .option("--expected-reviews <n>", "Number of expected reviews", parseInt)
  .option("--review-deadline <date>", "Review deadline (ISO date)")
  .option("--api-key <key>", "Account API key (required for private docs)")
  .option("--agent", "Mark this doc as agent-authored")
  .option("--meta <json>", "Arbitrary JSON metadata")
  .option("--json", "Output raw JSON response")
  .action(async (file: string, opts) => {
    info("Creating document...");

    const content = await readContentFromFileOrStdin(file);

    // Resolve API key: private docs need an account key (acct_...), public docs are optional
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const apiKey = opts.private
      ? resolveAccountApiKey(opts, entry, global)
      : resolveApiKeyOptional(opts, entry, global);

    const body: Record<string, unknown> = { content };
    if (opts.title) body.title = opts.title;
    if (opts.private) body.visibility = "private";
    if (opts.expectedReviews) body.expected_reviews = opts.expectedReviews;
    if (opts.reviewDeadline) body.review_deadline = opts.reviewDeadline;

    // --meta: parse JSON and merge
    if (opts.meta) {
      try {
        body.meta = JSON.parse(opts.meta);
      } catch {
        error("Invalid JSON for --meta");
        process.exit(EXIT_ERROR);
      }
    }

    const res = await api<{
      slug: string;
      magic_token: string;
      api_key: string;
      url?: string;
    }>("/docs", {
      method: "POST",
      body,
      apiKey,
    });

    if (!res.ok) fail("Failed to create document", res.status, res.data);

    const doc = res.data;
    const shareUrl = `${getShareBaseUrl()}/share/${doc.slug}`;

    await appendConfig({
      slug: doc.slug,
      api_key: doc.api_key,
      magic_token: doc.magic_token,
      url: shareUrl,
      author_type: opts.agent ? "agent" : undefined,
    });

    if (opts.json) {
      printJson(doc);
    } else {
      success("Document created\n");
      process.stdout.write(`${label("URL", cyan(shareUrl))}\n`);
      if (opts.private) {
        const privateUrl = `${shareUrl}?token=${doc.magic_token}`;
        process.stdout.write(`${label("Private URL", cyan(privateUrl))}\n`);
      }
      process.stdout.write(`${label("Slug", doc.slug)}\n`);
      process.stdout.write(`${label("Magic Token", doc.magic_token)}\n`);
      process.stdout.write(`${label("API Key", doc.api_key)}\n`);
      process.stdout.write(`\n${dim("Saved to .draftmark.json")}\n`);
    }
  });

// ---------------------------------------------------------------------------
// dm update <file> [slug]
// ---------------------------------------------------------------------------
program
  .command("update")
  .description("Update document content from a file (use - for stdin)")
  .argument("<file>", 'Path to a markdown file, or "-" to read from stdin')
  .argument("[slug]", "Document slug")
  .option("--magic-token <token>", "Magic token for authentication")
  .option("--title <title>", "Update document title")
  .option("--version-note <note>", "Version note for the update")
  .option("--json", "Output raw JSON response")
  .action(async (file: string, slugArg: string | undefined, opts) => {
    info("Updating document...");

    const content = await readContentFromFileOrStdin(file);

    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry, global);

    const body: Record<string, unknown> = { content };
    if (opts.title) body.title = opts.title;
    if (opts.versionNote) body.version_note = opts.versionNote;

    const res = await api(`/docs/${slug}`, {
      method: "PATCH",
      body,
      magicToken,
    });

    if (!res.ok) fail("Failed to update document", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Document updated.");
    }
  });

// ---------------------------------------------------------------------------
// dm status [slug]
// ---------------------------------------------------------------------------
program
  .command("status")
  .description("Show document status")
  .argument("[slug]", "Document slug")
  .option("--api-key <key>", "API key for authentication")
  .option("--format <format>", "Output format: table, json, minimal")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry, global);

    const res = await api<Record<string, unknown>>(`/docs/${slug}`, {
      apiKey,
    });

    if (!res.ok) fail("Failed to get document", res.status, res.data);

    const doc = res.data;
    const fmt = resolveFormat(opts);

    if (fmt === "json") {
      printJson(doc);
    } else if (fmt === "minimal") {
      process.stdout.write(formatStatusMinimal(doc) + "\n");
    } else {
      process.stdout.write(`\n${bold(String(doc.title || "(untitled)"))}\n\n`);
      process.stdout.write(`${label("Slug", String(doc.slug))}\n`);
      process.stdout.write(`${label("Status", String(doc.status))}\n`);
      process.stdout.write(`${label("Visibility", String(doc.visibility))}\n`);
      process.stdout.write(`${label("Comments", String(doc.comments_count ?? 0))}\n`);
      process.stdout.write(`${label("Reviews", String(doc.reviews_count ?? 0))}\n`);
      process.stdout.write(
        `${label("Accepting Feedback", doc.accepting_feedback ? green("yes") : yellow("no"))}\n`
      );
      if (doc.review_complete !== undefined) {
        process.stdout.write(
          `${label("Review Complete", doc.review_complete ? green("yes") : "no")}\n`
        );
      }
      if (doc.review_expired !== undefined) {
        process.stdout.write(
          `${label("Review Expired", doc.review_expired ? yellow("yes") : "no")}\n`
        );
      }
      process.stdout.write("\n");
    }
  });

// ---------------------------------------------------------------------------
// dm comments [slug]
// ---------------------------------------------------------------------------
program
  .command("comments")
  .description("List comments on a document")
  .argument("[slug]", "Document slug")
  .option("--api-key <key>", "API key for authentication")
  .option("--status <status>", "Filter by status (open, resolved, dismissed)")
  .option("--since <date>", "Show only comments after this date (ISO 8601)")
  .option("--format <format>", "Output format: table, json, minimal")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry, global);

    const params: Record<string, string> = {};
    if (opts.status) params.status = opts.status;

    const res = await api<Comment[]>(`/docs/${slug}/comments`, {
      apiKey,
      params,
    });

    if (!res.ok) fail("Failed to get comments", res.status, res.data);

    let comments = res.data;

    // --since: client-side date filter
    if (opts.since) {
      const sinceDate = new Date(opts.since);
      if (isNaN(sinceDate.getTime())) {
        error("Invalid date for --since. Use ISO 8601 format (e.g. 2026-03-27).");
        process.exit(EXIT_ERROR);
      }
      comments = comments.filter(
        (c) => c.created_at && new Date(c.created_at) >= sinceDate
      );
    }

    const fmt = resolveFormat(opts);

    if (fmt === "json") {
      printJson(comments);
    } else if (fmt === "minimal") {
      if (comments.length === 0) {
        info("No comments.");
      } else {
        for (const comment of comments) {
          process.stdout.write(formatCommentMinimal(comment) + "\n");
        }
      }
    } else {
      if (comments.length === 0) {
        info("No comments yet.");
      } else {
        process.stdout.write("\n");
        for (const comment of comments) {
          process.stdout.write(formatComment(comment) + "\n\n");
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// dm comment [slug] <body>
// ---------------------------------------------------------------------------
program
  .command("comment")
  .description("Add a comment to a document")
  .argument("[slug]", "Document slug (optional if .draftmark.json exists)")
  .argument("<body>", "Comment body")
  .option("--api-key <key>", "API key for authentication")
  .option("--author <name>", "Author name")
  .option("--author-type <type>", "Author type (e.g. agent)")
  .option("--line <n>", "Line number anchor", parseInt)
  .option("--selection <text>", "Selection text anchor")
  .option("--parent <id>", "Reply to a comment by id (threads under it)")
  .option("--json", "Output raw JSON response")
  .action(async (first: string, second: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();

    // If only one positional arg, it's the body and slug comes from config
    let slug: string;
    let body: string;
    if (second === undefined) {
      slug = resolveSlug(undefined, entry);
      body = first;
    } else {
      slug = first;
      body = second;
    }

    const apiKey = resolveApiKey(opts, entry, global);

    const payload: Record<string, unknown> = { body };
    if (opts.author) payload.author = opts.author;
    // --author-type flag, or fall back to entry.author_type from --agent on create
    if (opts.authorType) {
      payload.author_type = opts.authorType;
    } else if (entry?.author_type) {
      payload.author_type = entry.author_type;
    }
    if (opts.line) {
      // anchor_ref is an integer line number
      payload.anchor_type = "line";
      payload.anchor_ref = opts.line;
    } else if (opts.selection) {
      // the highlighted quote goes in anchor_text, not anchor_ref (an int column)
      payload.anchor_type = "selection";
      payload.anchor_text = opts.selection;
    }
    // Thread this comment under an existing one (a true nested reply)
    if (opts.parent) payload.parent_id = opts.parent;

    const res = await api(`/docs/${slug}/comments`, {
      method: "POST",
      body: payload,
      apiKey,
    });

    if (!res.ok) fail("Failed to add comment", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Comment added.");
    }
  });

// ---------------------------------------------------------------------------
// dm review [slug]
// ---------------------------------------------------------------------------
program
  .command("review")
  .description("Mark a document as reviewed")
  .argument("[slug]", "Document slug")
  .option("--api-key <key>", "API key for authentication")
  .option("--name <name>", "Reviewer name")
  .option("--type <type>", "Reviewer type (e.g. agent)")
  .option("--identifier <id>", "Unique reviewer identifier")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry, global);

    const payload: Record<string, unknown> = {};
    if (opts.name) payload.reviewer_name = opts.name;
    // --type flag, or fall back to entry.author_type from --agent on create
    if (opts.type) {
      payload.reviewer_type = opts.type;
    } else if (entry?.author_type) {
      payload.reviewer_type = entry.author_type;
    }
    if (opts.identifier) {
      payload.identifier = opts.identifier;
    } else {
      payload.identifier = `cli-${Date.now()}`;
    }

    const res = await api(`/docs/${slug}/reviews`, {
      method: "POST",
      body: payload,
      apiKey,
    });

    if (!res.ok) fail("Failed to submit review", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Review submitted.");
    }
  });

// ---------------------------------------------------------------------------
// dm react [slug] <emoji>
// ---------------------------------------------------------------------------
program
  .command("react")
  .description("Add a reaction to a document")
  .argument("[slug]", "Document slug (optional if .draftmark.json exists)")
  .argument("<emoji>", "Emoji reaction")
  .option("--api-key <key>", "API key for authentication")
  .option("--identifier <id>", "Unique identifier for dedup")
  .option("--json", "Output raw JSON response")
  .action(async (first: string, second: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();

    // Same pattern as comment: if one arg, it's the emoji
    let slug: string;
    let emoji: string;
    if (second === undefined) {
      slug = resolveSlug(undefined, entry);
      emoji = first;
    } else {
      slug = first;
      emoji = second;
    }

    const apiKey = resolveApiKey(opts, entry, global);

    const payload: Record<string, unknown> = {
      emoji,
      identifier: opts.identifier || `cli-${Date.now()}`,
    };

    const res = await api(`/docs/${slug}/reactions`, {
      method: "POST",
      body: payload,
      apiKey,
    });

    if (!res.ok) fail("Failed to add reaction", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success(`Reaction ${emoji} added.`);
    }
  });

// ---------------------------------------------------------------------------
// dm raw [slug]
// ---------------------------------------------------------------------------
program
  .command("raw")
  .description("Print raw markdown to stdout")
  .argument("[slug]", "Document slug")
  .option("--api-key <key>", "API key for authentication")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry, global);

    const res = await api<string>(`/docs/${slug}`, {
      apiKey,
      params: { format: "raw" },
    });

    if (!res.ok) {
      error(`Failed to get document (${res.status})`);
      process.exit(exitCodeForStatus(res.status));
    }

    process.stdout.write(String(res.data));
  });

// ---------------------------------------------------------------------------
// dm list
// ---------------------------------------------------------------------------
program
  .command("list")
  .description("List all documents in .draftmark.json")
  .option("--json", "Output raw JSON response")
  .action(async (opts) => {
    const entries = await readConfig();

    if (entries.length === 0) {
      info("No documents in .draftmark.json");
      return;
    }

    if (opts.json) {
      printJson(entries);
    } else {
      const headers = ["Slug", "URL", "Agent"];
      const rows = entries.map((e) => [
        e.slug,
        e.url,
        e.author_type || "",
      ]);
      process.stdout.write("\n" + formatTable(headers, rows) + "\n\n");
    }
  });

// ---------------------------------------------------------------------------
// dm browse [slug]
// ---------------------------------------------------------------------------
program
  .command("browse")
  .description("Open document in the default browser")
  .argument("[slug]", "Document slug")
  .action(async (slugArg: string | undefined) => {
    const entry = await getLastEntry();
    const slug = resolveSlug(slugArg, entry);
    const url = `${getShareBaseUrl()}/share/${slug}`;

    info(`Opening ${url}`);
    openInBrowser(url);
  });

// ---------------------------------------------------------------------------
// dm close [slug]
// ---------------------------------------------------------------------------
program
  .command("close")
  .description("Close a document for review")
  .argument("[slug]", "Document slug")
  .option("--magic-token <token>", "Magic token for authentication")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry, global);

    const res = await api(`/docs/${slug}`, {
      method: "PATCH",
      body: { status: "review_closed" },
      magicToken,
    });

    if (!res.ok) fail("Failed to close document", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Document closed for review.");
    }
  });

// ---------------------------------------------------------------------------
// dm open [slug]
// ---------------------------------------------------------------------------
program
  .command("open")
  .description("Re-open a document for review")
  .argument("[slug]", "Document slug")
  .option("--magic-token <token>", "Magic token for authentication")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry, global);

    const res = await api(`/docs/${slug}`, {
      method: "PATCH",
      body: { status: "open" },
      magicToken,
    });

    if (!res.ok) fail("Failed to open document", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Document re-opened for review.");
    }
  });

// ---------------------------------------------------------------------------
// dm delete [slug]
// ---------------------------------------------------------------------------
program
  .command("delete")
  .description("Delete a document")
  .argument("[slug]", "Document slug")
  .option("--magic-token <token>", "Magic token for authentication")
  .option("--confirm", "Confirm deletion")
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    if (!opts.confirm) {
      error("Deletion requires --confirm flag.");
      process.exit(EXIT_ERROR);
    }

    const entry = await getLastEntry();
    const global = await readGlobalConfig();
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry, global);

    const res = await api(`/docs/${slug}`, {
      method: "DELETE",
      magicToken,
    });

    if (!res.ok) fail("Failed to delete document", res.status, res.data);

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Document deleted.");
    }
  });

// ---------------------------------------------------------------------------
// dm login
// ---------------------------------------------------------------------------
program
  .command("login")
  .description("Save account credentials globally (~/.config/draftmark/config.json)")
  .option("--api-key <key>", "Account API key")
  .option("--magic-token <token>", "Default magic token")
  .action(async (opts) => {
    if (!opts.apiKey && !opts.magicToken) {
      error("Provide at least one of --api-key or --magic-token.");
      process.exit(EXIT_ERROR);
    }

    const existing = await readGlobalConfig();
    const updated = { ...existing };
    if (opts.apiKey) updated.api_key = opts.apiKey;
    if (opts.magicToken) updated.magic_token = opts.magicToken;

    await writeGlobalConfig(updated);
    success("Credentials saved to ~/.config/draftmark/config.json");
  });

// ---------------------------------------------------------------------------
// dm logout
// ---------------------------------------------------------------------------
program
  .command("logout")
  .description("Remove saved global credentials")
  .action(async () => {
    await writeGlobalConfig({});
    success("Global credentials removed.");
  });

// ---------------------------------------------------------------------------
// dm whoami
// ---------------------------------------------------------------------------
program
  .command("whoami")
  .description("Show current authentication sources")
  .action(async () => {
    const entry = await getLastEntry();
    const global = await readGlobalConfig();

    process.stdout.write("\n");

    // Global config
    if (global.api_key) {
      process.stdout.write(
        `${label("Global API Key", green(global.api_key.slice(0, 12) + "..."))}\n`
      );
    } else {
      process.stdout.write(`${label("Global API Key", dim("not set"))}\n`);
    }

    // Env vars
    if (process.env.DM_API_KEY) {
      process.stdout.write(`${label("DM_API_KEY env", green("set"))}\n`);
    }
    if (process.env.DM_MAGIC_TOKEN) {
      process.stdout.write(`${label("DM_MAGIC_TOKEN env", green("set"))}\n`);
    }

    // Local config
    if (entry) {
      process.stdout.write(
        `${label("Local config", green(`.draftmark.json (${entry.slug})`))}\n`
      );
    } else {
      process.stdout.write(`${label("Local config", dim("no .draftmark.json"))}\n`);
    }

    process.stdout.write("\n");
  });

// ---------------------------------------------------------------------------
// dm config
// ---------------------------------------------------------------------------
program
  .command("config")
  .description("Show resolved configuration from all sources")
  .option("--json", "Output raw JSON response")
  .action(async (opts) => {
    const entries = await readConfig();
    const global = await readGlobalConfig();
    const entry = entries.length > 0 ? entries[entries.length - 1] : null;

    const envKey = process.env.DM_API_KEY;
    const localKey = entry?.api_key;
    const globalKey = global.api_key;

    const resolved = {
      base_url: getBaseUrl(),
      share_base_url: getShareBaseUrl(),
      account_api_key: {
        source: (() => {
          if (envKey) return "env (DM_API_KEY)";
          if (globalKey) return "~/.config/draftmark/config.json";
          if (localKey) return ".draftmark.json";
          return null;
        })(),
        value: (() => {
          const key = envKey || globalKey || localKey;
          return key ? key.slice(0, 12) + "..." : null;
        })(),
      },
      doc_api_key: localKey
        ? { source: ".draftmark.json", value: localKey.slice(0, 12) + "..." }
        : null,
      magic_token: {
        source: (() => {
          if (process.env.DM_MAGIC_TOKEN) return "env (DM_MAGIC_TOKEN)";
          if (entry?.magic_token) return ".draftmark.json";
          if (global.magic_token) return "~/.config/draftmark/config.json";
          return null;
        })(),
        set: !!(process.env.DM_MAGIC_TOKEN || entry?.magic_token || global.magic_token),
      },
      local_docs: entries.length,
      active_slug: entry?.slug || null,
    };

    if (opts.json) {
      printJson(resolved);
    } else {
      process.stdout.write("\n");
      process.stdout.write(`${label("API Base URL", resolved.base_url)}\n`);
      process.stdout.write(`${label("Share Base URL", resolved.share_base_url)}\n`);
      process.stdout.write("\n");
      process.stdout.write(
        `${label("Account API Key", resolved.account_api_key.value ? `${green(resolved.account_api_key.value)} ${dim(`(${resolved.account_api_key.source})`)}` : dim("not set"))}\n`
      );
      if (resolved.doc_api_key) {
        process.stdout.write(
          `${label("Doc API Key", `${dim(resolved.doc_api_key.value)} ${dim(`(${resolved.doc_api_key.source})`)}`)} \n`
        );
      }
      process.stdout.write(
        `${label("Magic Token", resolved.magic_token.set ? `${green("set")} ${dim(`(${resolved.magic_token.source})`)}` : dim("not set"))}\n`
      );
      process.stdout.write("\n");
      process.stdout.write(`${label("Local docs", String(resolved.local_docs))}\n`);
      process.stdout.write(`${label("Active slug", resolved.active_slug || dim("none"))}\n`);
      process.stdout.write("\n");
    }
  });

program.parse();
