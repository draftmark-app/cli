const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

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

export function success(message: string): void {
  process.stderr.write(`${green("✓")} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${red("✗")} ${message}\n`);
}

export function info(message: string): void {
  process.stderr.write(`${dim("›")} ${message}\n`);
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

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
