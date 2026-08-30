import { createClient } from '@codecity/city';
// api/client.ts — the app's one client. Every backend call in the app goes
// through it, and the code behind it lives in @codecity/city, so the repo has a

const DEPLOY_BASE = import.meta.env.BASE_URL || '/';

export const API = createClient({ baseUrl: `${DEPLOY_BASE}api` });
