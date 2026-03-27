const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// ---------------------------------------------------------------------------
// Quiet mode
// ---------------------------------------------------------------------------

let quiet = false;

export function setQuiet(value: boolean): void {
  quiet = value;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

export function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function yellow(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}

export function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function label(name: string, value: string | number | boolean | undefined | null): string {
  return `${dim(name + ":")} ${value ?? dim("n/a")}`;
}

// ---------------------------------------------------------------------------
// Output helpers (stderr respects --quiet, stdout never suppressed)
// ---------------------------------------------------------------------------

export function success(message: string): void {
  if (!quiet) process.stderr.write(`${green("✓")} ${message}\n`);
}

export function error(message: string): void {
  if (!quiet) process.stderr.write(`${red("✗")} ${message}\n`);
}

export function info(message: string): void {
  if (!quiet) process.stderr.write(`${dim("›")} ${message}\n`);
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Comment formatting
// ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  body: string;
  author?: string;
  author_type?: string;
  status?: string;
  anchor_type?: string;
  anchor_ref?: string;
  created_at?: string;
  parent_id?: string | null;
}

export function formatComment(comment: Comment, indent = 0): string {
  const pad = "  ".repeat(indent);
  const authorDisplay = comment.author || "anonymous";
  const badge = comment.author_type === "agent" ? dim(" [agent]") : "";
  const status = comment.status ? dim(` (${comment.status})`) : "";

  let anchor = "";
  if (comment.anchor_type === "line" && comment.anchor_ref) {
    anchor = dim(` @ line ${comment.anchor_ref}`);
  } else if (comment.anchor_type === "selection" && comment.anchor_ref) {
    anchor = dim(` @ "${comment.anchor_ref}"`);
  }

  const header = `${pad}${bold(authorDisplay)}${badge}${status}${anchor}`;
  const body = comment.body
    .split("\n")
    .map((line) => `${pad}  ${line}`)
    .join("\n");

  return `${header}\n${body}`;
}

export function formatCommentMinimal(comment: Comment): string {
  const author = comment.author || "anonymous";
  const badge = comment.author_type === "agent" ? " [agent]" : "";
  const body = comment.body.replace(/\n/g, " ").slice(0, 80);
  const ellipsis = comment.body.length > 80 ? "..." : "";
  return `${author}${badge}: ${body}${ellipsis}`;
}

// ---------------------------------------------------------------------------
// Status minimal formatting
// ---------------------------------------------------------------------------

export function formatStatusMinimal(doc: Record<string, unknown>): string {
  const slug = doc.slug || "?";
  const status = doc.status || "?";
  const vis = doc.visibility || "?";
  const comments = doc.comments_count ?? 0;
  const reviews = doc.reviews_count ?? 0;
  return `${slug}\t${status}\t${vis}\t${comments}c\t${reviews}r`;
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

export function formatTable(
  headers: string[],
  rows: string[][],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );

  const header = headers.map((h, i) => h.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) => row.map((cell, i) => (cell || "").padEnd(widths[i])).join("  "))
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}
