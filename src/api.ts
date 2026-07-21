import { DraftmarkClient, type ApiResponse, type RequestOptions } from "@draftmark-app/client";
import { getBaseUrl } from "./config.js";

// Re-export the shared types so existing importers keep working.
export type { ApiError, ApiResponse, RequestOptions } from "@draftmark-app/client";

/**
 * Thin shim over the shared @draftmark-app/client transport. The CLI keeps its
 * result-style `{ ok, status, data }` contract (so every command call site is
 * unchanged and exit-code handling still works), while the fetch, error
 * normalization, and status-code mapping now live in the shared client.
 *
 * A fresh client per call keeps the base URL current — `getBaseUrl()` reflects
 * the `--base-url` flag / `DM_BASE_URL` override at call time.
 */
export function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return new DraftmarkClient({ baseUrl: getBaseUrl() }).raw<T>(path, opts);
}
