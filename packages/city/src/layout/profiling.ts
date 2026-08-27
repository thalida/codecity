import type { CityLayout } from '@/city/types/scene';
// city/layout/profiling.ts — opt-in per-phase profiler for the layout packer.

// ─── Profiling ───────────────────────────────────────────────────────────────
// Off by default; the _profEnabled guard keeps production cost to one branch per
// section. setLayoutProfiling(true) makes layoutCity log a per-phase breakdown
// and expose raw buckets (cumulative ms + count) via getLayoutProfile().
interface ProfBucket {
  ms: number;
  n: number;
}
let _profEnabled = false;
const _prof = new Map<string, ProfBucket>();
export function setLayoutProfiling(on: boolean): void {
  _profEnabled = on;
  _prof.clear();
}
export function getLayoutProfile(): Array<{ key: string; ms: number; n: number }> {
  return [..._prof.entries()].map(([key, b]) => ({ key, ms: b.ms, n: b.n }));
}
export function _profNow(): number {
  return _profEnabled ? performance.now() : 0;
}
export function _profEnd(key: string, t0: number): void {
  if (!_profEnabled) return;
  const dt = performance.now() - t0;
  const b = _prof.get(key);
  if (b) {
    b.ms += dt;
    b.n += 1;
  } else {
    _prof.set(key, { ms: dt, n: 1 });
  }
}
export function _profCount(key: string, n: number): void {
  if (!_profEnabled) return;
  const b = _prof.get(key);
  if (b) b.n += n;
  else _prof.set(key, { ms: 0, n });
}
function _profMs(key: string): number {
  return _prof.get(key)?.ms ?? 0;
}
function _profN(key: string): number {
  return _prof.get(key)?.n ?? 0;
}
export function _logLayoutProfile(layout: CityLayout): void {
  if (!_profEnabled) return;
  const total =
    _profMs('phase.computeFileStats') +
    _profMs('phase.estimateDirReaches') +
    _profMs('phase.layoutDir') +
    _profMs('phase.markJoinSides');
  const f = (ms: number) => ms.toFixed(0).padStart(6);
  const pct = (ms: number) => `${((ms / total) * 100).toFixed(0)}%`.padStart(4);
  const lines = [
    `[layout-profile] ${layout.buildings.length} buildings, ${layout.streets.length} streets — total ${total.toFixed(0)}ms`,
    `  computeFileStats   ${f(_profMs('phase.computeFileStats'))}ms ${pct(_profMs('phase.computeFileStats'))}`,
    `  estimateDirReaches ${f(_profMs('phase.estimateDirReaches'))}ms ${pct(_profMs('phase.estimateDirReaches'))}`,
    `  layoutDir          ${f(_profMs('phase.layoutDir'))}ms ${pct(_profMs('phase.layoutDir'))}`,
    `  markJoinSides      ${f(_profMs('phase.markJoinSides'))}ms ${pct(_profMs('phase.markJoinSides'))}`,
    `  ── within layoutDir ─────────────────────────────`,
    `  isMirrorInvariant  ${f(_profMs('placeChild.isMirrorInvariant'))}ms  (${_profN('placeChild.calls')} placeChild calls, ${_profN('placeChild.childRects')} childRects evaluated)`,
    `  findSmallestStem   ${f(_profMs('findSmallestValidStem'))}ms  (${_profN('findSmallestValidStem')} calls, ${_profN('stem.queries')} occ queries, ${_profN('stem.candidates')} candidates, ${_profN('stem.forbidden')} forbidden)`,
    `  childRectsBuild    ${f(_profMs('commit.childRectsBuild'))}ms`,
    `  translate+insert   ${f(_profMs('commit.translateInsert'))}ms`,
  ];
  console.log(lines.join('\n'));
}
