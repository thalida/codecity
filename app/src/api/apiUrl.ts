// api/apiUrl.ts — Shared builder for backend `/api` URLs. Centralizes the origin
// plus the app's deploy base (import.meta.env.BASE_URL) so every call works under
// a subpath, not only at the domain root, and sets query params uniformly
// (undefined values are skipped, so callers can pass optional params inline).

/** Build a URL for the `/api/<path>` endpoint. `path` has no leading slash. */
export function apiUrl(path: string, params?: Record<string, string | undefined>): string {
  const base = import.meta.env.BASE_URL || '/';
  const url = new URL(`${base}api/${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
