import { describe, it, expect, beforeEach } from 'vitest';
import { readEmbeddedJson } from '../src/main.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readEmbeddedJson', () => {
  it('parses JSON from a <script> element by id', () => {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'codecity-manifest';
    el.textContent = '{"root":"sample","tree":{"name":"sample"}}';
    document.body.appendChild(el);

    expect(readEmbeddedJson('codecity-manifest')).toEqual({
      root: 'sample',
      tree: { name: 'sample' },
    });
  });

  it('throws a clear error when the element is missing', () => {
    expect(() => readEmbeddedJson('does-not-exist'))
      .toThrow(/missing <script id="does-not-exist">/);
  });

  it('throws a clear error when the JSON is malformed', () => {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'codecity-manifest';
    el.textContent = '{ not: "valid json"';
    document.body.appendChild(el);

    expect(() => readEmbeddedJson('codecity-manifest'))
      .toThrow(/invalid JSON in <script id="codecity-manifest">/);
  });

  it('handles the placeholder case — raw token, not JSON — as a parse error', () => {
    // Before build.sh fills the placeholder, the textContent is `__MANIFEST__`
    // which is not valid JSON. We want a clear error rather than silent corruption.
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'codecity-manifest';
    el.textContent = '__MANIFEST__';
    document.body.appendChild(el);

    expect(() => readEmbeddedJson('codecity-manifest')).toThrow();
  });
});
