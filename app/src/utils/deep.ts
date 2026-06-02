// utils/deep.ts — Deep value equality + clone via JSON round-trip. The single
// source for "are these two values the same" / "give me an independent copy"
// across the settings layer (persist, drafts, controls hooks, ActionsBar) so
// the helper isn't re-implemented per file.
//
// JSON-roundtrip semantics — fine for every shape we put in signals (plain
// objects, arrays, primitives), but note: key order is significant in equality,
// `undefined`/functions are dropped, Dates serialize to strings, and cyclic
// values fall back (equal → false, clone → the original reference). Don't use
// these on non-JSON-safe data.

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function deepClone<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
