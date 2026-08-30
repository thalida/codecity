// lib/deep.ts — deep equality + clone via JSON round-trip, for the settings
// layer. JSON semantics: key order counts, `undefined` and functions are
// dropped, Dates become strings, and a cyclic value falls back (equal → false,
// clone → the original reference). Not for non-JSON-safe data.

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
