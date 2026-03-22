import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CONFIG_FILE = ".draftmark.json";

export interface DraftmarkEntry {
  slug: string;
  api_key: string;
  magic_token?: string;
  url: string;
}

function configPath(): string {
  return join(process.cwd(), CONFIG_FILE);
}

export async function readConfig(): Promise<DraftmarkEntry[]> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

export async function writeConfig(entries: DraftmarkEntry[]): Promise<void> {
  await writeFile(configPath(), JSON.stringify(entries, null, 2) + "\n");
}

export async function appendConfig(entry: DraftmarkEntry): Promise<void> {
  const entries = await readConfig();
  entries.push(entry);
  await writeConfig(entries);
}

export async function getLastEntry(): Promise<DraftmarkEntry | null> {
  const entries = await readConfig();
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

export function resolveSlug(slugArg: string | undefined, entry: DraftmarkEntry | null): string {
  if (slugArg) return slugArg;
  if (entry?.slug) return entry.slug;
  throw new Error("No slug provided and no .draftmark.json found in current directory.");
}

export function resolveApiKey(opts: { apiKey?: string }, entry: DraftmarkEntry | null): string {
  if (opts.apiKey) return opts.apiKey;
  if (process.env.DM_API_KEY) return process.env.DM_API_KEY;
  if (entry?.api_key) return entry.api_key;
  throw new Error(
    "No API key found. Provide --api-key, set DM_API_KEY, or run from a directory with .draftmark.json."
  );
}

export function resolveMagicToken(opts: { magicToken?: string }, entry: DraftmarkEntry | null): string {
  if (opts.magicToken) return opts.magicToken;
  if (process.env.DM_MAGIC_TOKEN) return process.env.DM_MAGIC_TOKEN;
  if (entry?.magic_token) return entry.magic_token;
  throw new Error(
    "No magic token found. Provide --magic-token, set DM_MAGIC_TOKEN, or ensure .draftmark.json has magic_token."
  );
}

export function getBaseUrl(): string {
  return process.env.DM_BASE_URL || "https://draftmark.app/api/v1";
}
