import { getBaseUrl } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  apiKey?: string;
  magicToken?: string;
  params?: Record<string, string>;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
};

function normalizeError(status: number, data: unknown): ApiError {
  const code = STATUS_CODES[status] || `http_${status}`;

  if (data && typeof data === "object" && "error" in data) {
    const raw = data as Record<string, unknown>;
    return {
      error: String(raw.error),
      code: typeof raw.code === "string" ? raw.code : code,
      details: raw.details,
    };
  }

  if (typeof data === "string" && data.length > 0) {
    return { error: data, code };
  }

  return { error: `Request failed with status ${status}`, code };
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

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: normalizeError(response.status, data) as T,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: data as T,
  };
}
