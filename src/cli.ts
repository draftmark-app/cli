#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { api } from "./api.js";
import {
  appendConfig,
  getLastEntry,
  resolveApiKey,
  resolveMagicToken,
  resolveSlug,
} from "./config.js";
import {
  bold,
  cyan,
  dim,
  error,
  formatComment,
  green,
  info,
  label,
  printJson,
  success,
  yellow,
  type Comment,
} from "./format.js";

const program = new Command();

program
  .name("dm")
  .description("CLI for Draftmark — markdown sharing for async collaboration")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// dm create <file>
// ---------------------------------------------------------------------------
program
  .command("create")
  .description("Create a new document from a markdown file")
  .argument("<file>", "Path to a markdown file")
  .option("--private", "Create as private (magic link only)")
  .option("--title <title>", "Document title")
  .option("--expected-reviews <n>", "Number of expected reviews", parseInt)
  .option("--review-deadline <date>", "Review deadline (ISO date)")
  .option("--json", "Output raw JSON response")
  .action(async (file: string, opts) => {
    info("Creating document...");

    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      error(`Could not read file: ${file}`);
      process.exit(1);
    }

    const body: Record<string, unknown> = { content };
    if (opts.title) body.title = opts.title;
    if (opts.private) body.visibility = "private";
    if (opts.expectedReviews) body.expected_reviews = opts.expectedReviews;
    if (opts.reviewDeadline) body.review_deadline = opts.reviewDeadline;

    const res = await api<{
      slug: string;
      magic_token: string;
      api_key: string;
      url?: string;
    }>("/docs", {
      method: "POST",
      body,
    });

    if (!res.ok) {
      error(`Failed to create document (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

    const doc = res.data;
    const shareUrl = `https://draftmark.app/share/${doc.slug}`;

    await appendConfig({
      slug: doc.slug,
      api_key: doc.api_key,
      magic_token: doc.magic_token,
      url: shareUrl,
    });

    if (opts.json) {
      printJson(doc);
    } else {
      success("Document created\n");
      process.stdout.write(`${label("URL", cyan(shareUrl))}\n`);
      process.stdout.write(`${label("Slug", doc.slug)}\n`);
      process.stdout.write(`${label("Magic Token", doc.magic_token)}\n`);
      process.stdout.write(`${label("API Key", doc.api_key)}\n`);
      process.stdout.write(`\n${dim("Saved to .draftmark.json")}\n`);
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
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry);

    const res = await api<Record<string, unknown>>(`/docs/${slug}`, {
      apiKey,
    });

    if (!res.ok) {
      error(`Failed to get document (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

    const doc = res.data;

    if (opts.json) {
      printJson(doc);
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
  .option("--json", "Output raw JSON response")
  .action(async (slugArg: string | undefined, opts) => {
    const entry = await getLastEntry();
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry);

    const params: Record<string, string> = {};
    if (opts.status) params.status = opts.status;

    const res = await api<Comment[]>(`/docs/${slug}/comments`, {
      apiKey,
      params,
    });

    if (!res.ok) {
      error(`Failed to get comments (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

    const comments = res.data;

    if (opts.json) {
      printJson(comments);
    } else if (comments.length === 0) {
      info("No comments yet.");
    } else {
      process.stdout.write("\n");
      for (const comment of comments) {
        process.stdout.write(formatComment(comment) + "\n\n");
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
  .option("--json", "Output raw JSON response")
  .action(async (first: string, second: string | undefined, opts) => {
    const entry = await getLastEntry();

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

    const apiKey = resolveApiKey(opts, entry);

    const payload: Record<string, unknown> = { body };
    if (opts.author) payload.author = opts.author;
    if (opts.authorType) payload.author_type = opts.authorType;
    if (opts.line) {
      payload.anchor_type = "line";
      payload.anchor_ref = String(opts.line);
    } else if (opts.selection) {
      payload.anchor_type = "selection";
      payload.anchor_ref = opts.selection;
    }

    const res = await api(`/docs/${slug}/comments`, {
      method: "POST",
      body: payload,
      apiKey,
    });

    if (!res.ok) {
      error(`Failed to add comment (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

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
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry);

    const payload: Record<string, unknown> = {};
    if (opts.name) payload.reviewer_name = opts.name;
    if (opts.type) payload.reviewer_type = opts.type;
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

    if (!res.ok) {
      error(`Failed to submit review (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Review submitted.");
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
    const slug = resolveSlug(slugArg, entry);
    const apiKey = resolveApiKey(opts, entry);

    const res = await api<string>(`/docs/${slug}`, {
      apiKey,
      params: { format: "raw" },
    });

    if (!res.ok) {
      error(`Failed to get document (${res.status})`);
      process.exit(1);
    }

    process.stdout.write(String(res.data));
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
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry);

    const res = await api(`/docs/${slug}`, {
      method: "PATCH",
      body: { status: "review_closed" },
      magicToken,
    });

    if (!res.ok) {
      error(`Failed to close document (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

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
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry);

    const res = await api(`/docs/${slug}`, {
      method: "PATCH",
      body: { status: "open" },
      magicToken,
    });

    if (!res.ok) {
      error(`Failed to open document (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

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
      process.exit(1);
    }

    const entry = await getLastEntry();
    const slug = resolveSlug(slugArg, entry);
    const magicToken = resolveMagicToken(opts, entry);

    const res = await api(`/docs/${slug}`, {
      method: "DELETE",
      magicToken,
    });

    if (!res.ok) {
      error(`Failed to delete document (${res.status})`);
      printJson(res.data);
      process.exit(1);
    }

    if (opts.json) {
      printJson(res.data);
    } else {
      success("Document deleted.");
    }
  });

program.parse();
