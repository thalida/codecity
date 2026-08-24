// api/apiUrl.ts — Shared builder for backend `/api` URLs. Centralizes the origin
// plus the app's deploy base (import.meta.env.BASE_URL) so every call works under
// a subpath, not only at the domain root, and sets query params uniformly
// (undefined values are skipped, so callers can pass optional params inline).

/**
 * Build a URL for the `/api/<path>` endpoint. `path` has no leading slash.
 * Array values emit one repeated query param per entry (e.g. `exclude`); scalar
 * values overwrite, matching the backend's repeated-param contract.
 */
export function apiUrl(
  path: string,
  params?: Record<string, string | string[] | undefined>
): string {
  const base = import.meta.env.BASE_URL || '/';
  const url = new URL(`${base}api/${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}
