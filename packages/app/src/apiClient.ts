// apiClient.ts — the app's one client. Every backend call in the app goes
// through it, and the code behind it lives in @codecity/city, so the repo has a
// single place that knows the wire format.
//
// The deploy base is resolved HERE, not in the package: `import.meta.env` is a
// Vite-ism and a package cannot depend on its consumer's bundler. The base is a
// path, never an origin — same-origin only, see the package's client/url.ts.

import { createClient } from '@codecity/city';

const DEPLOY_BASE = import.meta.env.BASE_URL || '/';

export const API = createClient({ baseUrl: `${DEPLOY_BASE}api` });
