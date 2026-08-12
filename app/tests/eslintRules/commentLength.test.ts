// The cap's own tests. It judges every comment in the repo, so the edges it
// gets wrong are the ones that make people disable it.

import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import css from '@eslint/css';
import { commentLength, cssCommentLength } from '../../eslint-rules/comment-length.js';

// RuleTester reaches for globals; vitest doesn't publish them here.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ts = new RuleTester();
const cssTester = new RuleTester({
  plugins: { css },
  language: 'css/css',
});

/** Padding so a comment under test isn't on line 1, where the header cap
 *  applies instead. */
const NOT_HEADER = 'const x = 1;\n';

const tooLong = (lines: number, max: number) => ({
  messageId: 'tooLong',
  data: { lines: String(lines), max: String(max) },
});

describe('house/comment-length', () => {
  ts.run('comment-length', commentLength, {
    valid: [
      { code: `${NOT_HEADER}// one line\nconst y = 1;\n` },
      { code: `${NOT_HEADER}// one\n// two\nconst y = 1;\n` },
      { code: `${NOT_HEADER}/* one\n   two */\nconst y = 1;\n` },

      // A file header gets to line 4, and only on line 1.
      { code: '// h1\n// h2\n// h3\n// h4\nconst y = 1;\n' },

      // Comments trailing code are separate notes, however many run together.
      {
        code: 'const a = 1; // one\nconst b = 2; // two\nconst c = 3; // three\nconst d = 4; // four\n',
      },

      // A blank line ends a run, so two short blocks are two blocks.
      { code: `${NOT_HEADER}// one\n// two\n\n// three\n// four\nconst y = 1;\n` },

      // Directives are machine-readable, not prose.
      {
        code: `${NOT_HEADER}/* eslint-disable no-console,\n   no-alert,\n   no-debugger,\n   no-empty */\nconst y = 1;\n`,
      },
      {
        code: `${NOT_HEADER}// @ts-expect-error one\n// @ts-expect-error two\n// @ts-expect-error three\nconst y = 1;\n`,
      },

      // Caps are configurable.
      {
        code: `${NOT_HEADER}// one\n// two\n// three\nconst y = 1;\n`,
        options: [{ max: 3 }],
      },
    ],

    invalid: [
      {
        code: `${NOT_HEADER}// one\n// two\n// three\nconst y = 1;\n`,
        errors: [tooLong(3, 2)],
      },
      {
        code: `${NOT_HEADER}/* one\n   two\n   three */\nconst y = 1;\n`,
        errors: [tooLong(3, 2)],
      },

      // A header one line past its own, larger cap.
      {
        code: '// h1\n// h2\n// h3\n// h4\n// h5\nconst y = 1;\n',
        errors: [tooLong(5, 4)],
      },

      // The header allowance is for line 1 only; further down, the cap is 2.
      {
        code: `${NOT_HEADER}\n// b1\n// b2\n// b3\nconst y = 1;\n`,
        errors: [tooLong(3, 2)],
      },

      // Each over-long block reports once, not once per line.
      {
        code: `${NOT_HEADER}// a1\n// a2\n// a3\n\nconst y = 1;\n\n// b1\n// b2\n// b3\n// b4\n`,
        errors: [tooLong(3, 2), tooLong(4, 2)],
      },

      // A trailing note doesn't absorb the own-line block under it.
      {
        code: `const a = 1; // trailing\n// own one\n// own two\n// own three\n`,
        errors: [tooLong(3, 2)],
      },

      // Tightening the cap catches what the default allows.
      {
        code: `${NOT_HEADER}// one\n// two\nconst y = 1;\n`,
        options: [{ max: 1 }],
        errors: [tooLong(2, 1)],
      },
    ],
  });
});

describe('house/css-comment-length', () => {
  cssTester.run('css-comment-length', cssCommentLength, {
    valid: [
      { code: '.a {\n  color: red;\n}\n' },
      { code: '.a { color: red; }\n/* one\n   two */\n.b { color: blue; }\n' },

      // Header allowance, on line 1.
      { code: '/* h1\n   h2\n   h3\n   h4 */\n.a { color: red; }\n' },

      // Trailing a declaration, however long the line.
      { code: '.a {\n  color: red; /* the one reason this is not a token */\n}\n' },

      // Trailing and running over several lines — the case that actually
      // exercises the exemption, since a one-liner can't breach the cap.
      { code: '.a {\n  color: red; /* one\n     two\n     three */\n}\n' },
    ],

    invalid: [
      {
        code: '.a { color: red; }\n/* one\n   two\n   three */\n.b { color: blue; }\n',
        errors: [tooLong(3, 2)],
      },
      {
        code: '/* h1\n   h2\n   h3\n   h4\n   h5 */\n.a { color: red; }\n',
        errors: [tooLong(5, 4)],
      },
      {
        code: '.a { color: red; }\n/* one\n   two\n   three */\n.b {}\n/* four\n   five\n   six */\n',
        errors: [tooLong(3, 2), tooLong(3, 2)],
      },
    ],
  });
});
