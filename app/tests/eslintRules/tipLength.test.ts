// The cap's own tests. It reads settings copy, so what it counts (quotes,
// concatenation, JSX) has to match what the panel actually renders.

import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { tipMaxLength } from '../../eslint-rules/tip-length.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ts = new RuleTester();
const tsx = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const long = (n: number) => 'x'.repeat(n);

const tooLong = (length: number, max: number) => ({
  messageId: 'tooLong',
  data: { length: String(length), max: String(max) },
});

describe('house/tip-length', () => {
  ts.run('tip-length', tipMaxLength, {
    valid: [
      { code: `const f = { tip: '${long(160)}' };` },
      // Only the tip is copy; a label or a long identifier is not.
      { code: `const f = { label: '${long(400)}' };` },
      // An interpolated tip can't be measured from the source.
      { code: 'const f = { tip: `${prefix} and the rest` };' },
      // A computed key that happens to read `tip` isn't the field's tip.
      { code: `const f = { [tip]: '${long(400)}' };` },
      { code: `const f = { tip: '${long(200)}' };`, options: [{ max: 200 }] },
    ],
    invalid: [
      {
        code: `const f = { tip: '${long(161)}' };`,
        errors: [tooLong(161, 160)],
      },
      // Concatenation and templates add up to one rendered string.
      {
        code: `const f = { tip: '${long(100)}' + '${long(100)}' };`,
        errors: [tooLong(200, 160)],
      },
      {
        code: `const f = { tip: \`${long(161)}\` };`,
        errors: [tooLong(161, 160)],
      },
      {
        code: `const f = { tip: '${long(100)}' };`,
        options: [{ max: 50 }],
        errors: [tooLong(100, 50)],
      },
    ],
  });

  tsx.run('tip-length (jsx)', tipMaxLength, {
    valid: [`const el = <Row tip="${long(160)}" />;`],
    invalid: [
      {
        code: `const el = <Row tip="${long(161)}" />;`,
        errors: [tooLong(161, 160)],
      },
      {
        code: `const el = <Row tip={\`${long(161)}\`} />;`,
        errors: [tooLong(161, 160)],
      },
    ],
  });
});
