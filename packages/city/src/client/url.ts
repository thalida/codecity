// client/url.ts — builds every `/api/<path>` URL from the base the caller gave
// the client, and sets query params uniformly (undefined values are skipped, so
// callers can pass optional params inline).
//
// The base arrives as a constructor argument rather than being read from
// `import.meta.env.BASE_URL`: that is a Vite-ism, and a package cannot depend on
// its consumer's bundler. The app resolves its own deploy base and passes it in.

/** Builds a URL for `<baseUrl>/<path>`. `path` has no leading slash. */
export type ApiUrl = (
  path: string,
  params?: Record<string, string | string[] | undefined>
) => string;

/**
 * `baseUrl` is a PATH (`/api`, or a subpath under a deploy base), never an
 * origin. The package is embeddable in any app served from the same host as the
 * backend; cross-origin is out of scope, and deliberately so — the backend's
 * SameSiteApiMiddleware 403s cross-site `/api` requests to stop an `<img src>`
 * making the server hand a repo's bytes to whatever tag asked.
 *
 * Array values emit one repeated query param per entry (e.g. `exclude`); scalar
 * values overwrite, matching the backend's repeated-param contract.
 */
export function createApiUrl(baseUrl: string): ApiUrl {
  // One trailing slash, so `${base}${path}` never doubles or drops one.
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return function apiUrl(path, params) {
    const url = new URL(`${base}${path}`, window.location.origin);
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
  };
}
