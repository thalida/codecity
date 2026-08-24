// eslint-rules/index.js — the `house` plugin: every rule this repo enforces
// about how much prose a reader has to wade through.

import { commentLength, cssCommentLength } from './comment-length.js';
import { tipMaxLength } from './tip-length.js';

export default {
  rules: {
    'comment-length': commentLength,
    'css-comment-length': cssCommentLength,
    'tip-length': tipMaxLength,
  },
};
