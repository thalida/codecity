// eslint-rules/comment-length.js — caps how long a comment may run.
// Density is the point: a long block buries the one non-obvious fact in it.

/** Consecutive `//` lines count as one block, so the cap can't be split around. */
function toBlocks(comments) {
  const blocks = [];
  let run = null;
  for (const c of comments) {
    if (c.type === 'Block') {
      blocks.push({ first: c, last: c, lines: c.loc.end.line - c.loc.start.line + 1 });
      run = null;
      continue;
    }
    if (run && c.loc.start.line === run.last.loc.start.line + 1) {
      run.last = c;
      run.lines += 1;
      continue;
    }
    run = { first: c, last: c, lines: 1 };
    blocks.push(run);
  }
  return blocks;
}

/** Tooling directives are machine-readable, not prose. */
const DIRECTIVE = /^\s*(eslint|global|prettier-ignore|@ts-|c8 |v8 |istanbul )/;

export const commentLength = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Cap comment blocks so the non-obvious why stays findable' },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'integer', minimum: 1 },
          header: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        'Comment block runs {{lines}} lines; the cap is {{max}}. Keep the one non-obvious why, or drop it.',
    },
  },
  create(context) {
    const { max = 2, header = 4 } = context.options[0] ?? {};
    return {
      Program() {
        for (const block of toBlocks(context.sourceCode.getAllComments())) {
          if (DIRECTIVE.test(block.first.value)) continue;
          // The file header gets more room: it names the module's whole job.
          const cap = block.first.loc.start.line === 1 ? header : max;
          if (block.lines <= cap) continue;
          context.report({
            loc: { start: block.first.loc.start, end: block.last.loc.end },
            messageId: 'tooLong',
            data: { lines: String(block.lines), max: String(cap) },
          });
        }
      },
    };
  },
};

/** CSS has only block comments, so each one stands alone. */
export const cssCommentLength = {
  meta: { ...commentLength.meta },
  create(context) {
    const { max = 2, header = 4 } = context.options[0] ?? {};
    return {
      StyleSheet() {
        for (const c of context.sourceCode.comments) {
          const lines = c.loc.end.line - c.loc.start.line + 1;
          const cap = c.loc.start.line === 1 ? header : max;
          if (lines <= cap) continue;
          context.report({
            loc: c.loc,
            messageId: 'tooLong',
            data: { lines: String(lines), max: String(cap) },
          });
        }
      },
    };
  },
};

export default {
  rules: { 'comment-length': commentLength, 'css-comment-length': cssCommentLength },
};
