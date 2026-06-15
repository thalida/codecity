// city/utils/path.ts — Generic manifest-path string helper. No DOM, no
// Three.js scene access — just data → data.

// parentDirPath(p) — return the parent directory path for a manifest path.
// Returns null for root ('.' / ''). Examples:
//   "src/utils/path.ts" → "src/utils"
//   "src"                 → "."
//   "."                   → null
export function parentDirPath(p: string | null | undefined): string | null {
  if (!p || p === '.' || p === '') return null;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '.';
}
