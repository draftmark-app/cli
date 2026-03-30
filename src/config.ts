import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_FILE = ".draftmark.json";

export interface DraftmarkEntry {
  slug: string;
  api_key: string;
  magic_token?: string;
  url: string;
  author_type?: string;
}

export interface GlobalConfig {
  api_key?: string;
  magic_token?: string;
}

// ---------------------------------------------------------------------------
// Local config (.draftmark.json in cwd)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Global config (~/.config/draftmark/config.json)
// ---------------------------------------------------------------------------

function globalConfigDir(): string {
  return join(homedir(), ".config", "draftmark");
}

function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(globalConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  await mkdir(globalConfigDir(), { recursive: true });
  await writeFile(globalConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Resolution helpers (flag > env > local config > global config)
// ---------------------------------------------------------------------------

export function resolveSlug(slugArg: string | undefined, entry: DraftmarkEntry | null): string {
  if (slugArg) return slugArg;
  if (entry?.slug) return entry.slug;
  throw new Error("No slug provided and no .draftmark.json found in current directory.");
}

export function resolveApiKey(
  opts: { apiKey?: string },
  entry: DraftmarkEntry | null,
  global?: GlobalConfig
): string {
  if (opts.apiKey) return opts.apiKey;
  if (process.env.DM_API_KEY) return process.env.DM_API_KEY;
  if (entry?.api_key) return entry.api_key;
  if (global?.api_key) return global.api_key;
  throw new Error(
    "No API key found. Provide --api-key, set DM_API_KEY, run from a directory with .draftmark.json, or run `dm login`."
  );
}

export function resolveApiKeyOptional(
  opts: { apiKey?: string },
  entry: DraftmarkEntry | null,
  global?: GlobalConfig
): string | undefined {
  if (opts.apiKey) return opts.apiKey;
  if (process.env.DM_API_KEY) return process.env.DM_API_KEY;
  if (entry?.api_key) return entry.api_key;
  if (global?.api_key) return global.api_key;
  return undefined;
}

/**
 * Resolve an account-level API key (acct_...) for operations that require
 * account auth (e.g. creating private docs). Prefers account keys over
 * doc-level keys: flag → env → global config (acct_) → local config.
 */
export function resolveAccountApiKey(
  opts: { apiKey?: string },
  entry: DraftmarkEntry | null,
  global?: GlobalConfig
): string {
  // Explicit flag always wins
  if (opts.apiKey) return opts.apiKey;
  // Env var — user controls what they put here
  if (process.env.DM_API_KEY) return process.env.DM_API_KEY;
  // Global config first (likely acct_...), then local (likely key_...)
  if (global?.api_key) return global.api_key;
  if (entry?.api_key) return entry.api_key;
  throw new Error(
    "No account API key found. Provide --api-key, set DM_API_KEY, or run `dm login --api-key acct_...`."
  );
}

export function resolveMagicToken(
  opts: { magicToken?: string },
  entry: DraftmarkEntry | null,
  global?: GlobalConfig
): string {
  if (opts.magicToken) return opts.magicToken;
  if (process.env.DM_MAGIC_TOKEN) return process.env.DM_MAGIC_TOKEN;
  if (entry?.magic_token) return entry.magic_token;
  if (global?.magic_token) return global.magic_token;
  throw new Error(
    "No magic token found. Provide --magic-token, set DM_MAGIC_TOKEN, or ensure .draftmark.json has magic_token."
  );
}

// ---------------------------------------------------------------------------
// Base URL resolution
// ---------------------------------------------------------------------------

let baseUrlOverride: string | undefined;

export function setBaseUrl(url: string): void {
  baseUrlOverride = url;
}

export function getBaseUrl(): string {
  return baseUrlOverride || process.env.DM_BASE_URL || "https://draftmark.app/api/v1";
}

export function getShareBaseUrl(): string {
  const apiBase = getBaseUrl();
  // Strip /api/v1 suffix to get the site origin
  try {
    const url = new URL(apiBase);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://draftmark.app";
  }
}
