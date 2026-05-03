import { describe, it, expect } from 'vitest';
import {
  hslToComponents,
  componentsToHsl,
  shadeColor,
  shadeAndShiftHue,
  shadeByRatio,
} from '../../scene/hsl.js';

describe('hslToComponents', () => {
  it('parses a standard hsl() string', () => {
    const c = hslToComponents('hsl(215, 80%, 55%)');
    expect(c).toEqual({ h: 215, s: 80, l: 55 });
  });

  it('handles whitespace variations', () => {
    expect(hslToComponents('hsl(0,0%,0%)')).toEqual({ h: 0, s: 0, l: 0 });
    expect(hslToComponents('hsl( 120 , 50% , 25% )')).toEqual({ h: 120, s: 50, l: 25 });
  });

  it('accepts HSL in upper or mixed case', () => {
    expect(hslToComponents('HSL(10, 20%, 30%)')).toEqual({ h: 10, s: 20, l: 30 });
  });
});

describe('componentsToHsl', () => {
  it('formats components as an hsl() string', () => {
    expect(componentsToHsl(215, 80, 55)).toBe('hsl(215, 80.0%, 55.0%)');
  });

  it('rounds hue to integer', () => {
    expect(componentsToHsl(215.4, 80, 55)).toBe('hsl(215, 80.0%, 55.0%)');
    expect(componentsToHsl(215.6, 80, 55)).toBe('hsl(216, 80.0%, 55.0%)');
  });
});

describe('hslToComponents / componentsToHsl round-trip', () => {
  it('recovers integer components exactly', () => {
    for (const input of ['hsl(0, 0%, 0%)', 'hsl(180, 50%, 50%)', 'hsl(359, 100%, 100%)']) {
      const c = hslToComponents(input);
      expect(hslToComponents(componentsToHsl(c.h, c.s, c.l))).toEqual(c);
    }
  });
});

describe('shadeColor', () => {
  it('increases lightness by a positive amount', () => {
    const out = shadeColor('hsl(200, 50%, 40%)', 10);
    expect(hslToComponents(out).l).toBeCloseTo(50);
  });

  it('decreases lightness by a negative amount', () => {
    const out = shadeColor('hsl(200, 50%, 40%)', -15);
    expect(hslToComponents(out).l).toBeCloseTo(25);
  });

  it('clamps to 100 on the high end', () => {
    const out = shadeColor('hsl(200, 50%, 90%)', 50);
    expect(hslToComponents(out).l).toBe(100);
  });

  it('clamps to 0 on the low end', () => {
    const out = shadeColor('hsl(200, 50%, 10%)', -50);
    expect(hslToComponents(out).l).toBe(0);
  });

  it('leaves hue and saturation unchanged', () => {
    const out = shadeColor('hsl(200, 50%, 40%)', 10);
    const c = hslToComponents(out);
    expect(c.h).toBe(200);
    expect(c.s).toBeCloseTo(50);
  });
});

describe('shadeAndShiftHue', () => {
  it('wraps hue forward through 360', () => {
    const out = shadeAndShiftHue('hsl(350, 50%, 50%)', 0, 30, null);
    expect(hslToComponents(out).h).toBe(20);
  });

  it('wraps hue backward through 0', () => {
    const out = shadeAndShiftHue('hsl(10, 50%, 50%)', 0, -30, null);
    expect(hslToComponents(out).h).toBe(340);
  });

  it('respects the minLightness floor', () => {
    const out = shadeAndShiftHue('hsl(200, 50%, 30%)', -100, 0, 10);
    expect(hslToComponents(out).l).toBe(10);
  });

  it('treats null minLightness as a floor of 0', () => {
    const out = shadeAndShiftHue('hsl(200, 50%, 30%)', -100, 0, null);
    expect(hslToComponents(out).l).toBe(0);
  });
});

describe('shadeByRatio', () => {
  it('multiplies lightness by the ratio', () => {
    const out = shadeByRatio('hsl(200, 50%, 60%)', 0.5, 0, 0);
    expect(hslToComponents(out).l).toBeCloseTo(30);
  });

  it('respects the absolute floor', () => {
    const out = shadeByRatio('hsl(200, 50%, 20%)', 0.1, 0, 15);
    expect(hslToComponents(out).l).toBe(15);
  });

  it('shifts the hue by hueDelta', () => {
    const out = shadeByRatio('hsl(100, 50%, 50%)', 1.0, 10, 0);
    expect(hslToComponents(out).h).toBe(110);
  });

  it('wraps hue through 360', () => {
    const out = shadeByRatio('hsl(350, 50%, 50%)', 1.0, 20, 0);
    expect(hslToComponents(out).h).toBe(10);
  });
});
