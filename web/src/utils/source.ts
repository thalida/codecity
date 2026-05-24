// source.ts — Source URL classification helpers. Used by the boot
// orchestrator and the source-picker flow to render the loading overlay
// and the recents list with a kind ('git' | 'local') and a short label.

export function _srcKind(src: string): 'git' | 'local' {
  return /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src) ? 'git' : 'local';
}

export function _deriveLabel(src: string): string {
  if (_srcKind(src) === 'git') {
    // git URL — try "owner/repo" from the last two path segments
    const m = src.match(/[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
    return src;
  }
  // Local path — basename
  const parts = src.split(/[\/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : src;
}
