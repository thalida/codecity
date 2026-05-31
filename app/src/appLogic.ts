// appLogic.ts — Re-export shell. Boot logic lives in runtime/boot.ts.
// This file exists so App.tsx's existing import path continues to resolve
// while the runtime/ modules are the true home of all boot logic.

export { bootApp as runAppLogic } from './runtime/boot';
export { applyPendingTitle } from './utils/pendingTitle';
export { EMPTY_MANIFEST } from './constants/manifest';
