// eslint-rules/tip-length.js — caps how long a settings field's `tip` may run.
// A tip sits under a control in a narrow panel: past a couple of lines it stops
// being read at all, and the one thing the label can't say is lost in it.

/** Concatenation and template literals still add up to what the panel renders. */
function tipLength(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value.length : null;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length > 0) return null;
    return node.quasis.reduce((n, q) => n + q.value.cooked.length, 0);
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = tipLength(node.left);
    const right = tipLength(node.right);
    return left == null || right == null ? null : left + right;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const tipMaxLength = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Cap settings tips so the one non-obvious fact stays readable' },
    schema: [
      {
        type: 'object',
        properties: { max: { type: 'integer', minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        'Tip runs {{length}} characters; the cap is {{max}}. Say what the label cannot, and stop.',
    },
  },
  create(context) {
    const { max = 160 } = context.options[0] ?? {};
    return {
      Property(node) {
        const key = node.key.type === 'Identifier' ? node.key.name : node.key.value;
        if (key !== 'tip' || node.computed) return;
        const length = tipLength(node.value);
        if (length == null || length <= max) return;
        context.report({
          node: node.value,
          messageId: 'tooLong',
          data: { length: String(length), max: String(max) },
        });
      },
      JSXAttribute(node) {
        if (node.name.name !== 'tip' || !node.value) return;
        const expr =
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        const length = tipLength(expr);
        if (length == null || length <= max) return;
        context.report({
          node: expr,
          messageId: 'tooLong',
          data: { length: String(length), max: String(max) },
        });
      },
    };
  },
};
