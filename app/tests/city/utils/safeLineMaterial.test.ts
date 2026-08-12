import { describe, it, expect } from 'vitest';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  createSafeLineMaterial,
  STOCK_NORMALIZE,
  GUARDED_NORMALIZE,
} from '@/city/utils/safeLineMaterial';

describe('createSafeLineMaterial', () => {
  // Pins the stock shader text: a three upgrade that rephrases it would make
  // the guard's string replace silently no-op — this failing is the signal.
  it('stock LineMaterial still contains the unguarded normalize', () => {
    const stock = new LineMaterial({});
    expect(stock.vertexShader).toContain(STOCK_NORMALIZE);
  });

  it('replaces the unguarded normalize with the zero-safe form', () => {
    const safe = createSafeLineMaterial({});
    expect(safe.vertexShader).not.toContain(STOCK_NORMALIZE);
    expect(safe.vertexShader).toContain(GUARDED_NORMALIZE);
  });

  it('passes constructor params through', () => {
    const safe = createSafeLineMaterial({ linewidth: 7, transparent: true, opacity: 0.5 });
    expect(safe.linewidth).toBe(7);
    expect(safe.transparent).toBe(true);
    expect(safe.opacity).toBe(0.5);
  });
});
