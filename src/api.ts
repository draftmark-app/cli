import { getBaseUrl } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  apiKey?: string;
  magicToken?: string;
  params?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}${path}`);

  if (opts.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  if (opts.magicToken) {
    headers["X-Magic-Token"] = opts.magicToken;
  }

  const response = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    data: data as T,
  };
}
