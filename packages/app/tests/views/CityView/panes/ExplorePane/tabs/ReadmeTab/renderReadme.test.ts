import { describe, it, expect } from 'vitest';
import { renderReadme } from '@/features/city/components/ExplorePane/tabs/ReadmeTab/ReadmeTab';
import { TEST_SOURCE } from '@codecity/city/testing';

// A README is a file out of whatever repo was opened, and its HTML goes
// straight into innerHTML. Anyone who can get a repo scanned writes this.
const render = (md: string) => renderReadme(md, TEST_SOURCE, 'README.md');

describe('renderReadme', () => {
  it('drops an inline event handler', () => {
    const html = render('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('drops a script tag and its contents', () => {
    const html = render('# Title\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('drops a javascript: link', () => {
    expect(render('[click](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('drops an svg onload and an iframe', () => {
    const html = render('<svg onload="alert(1)"></svg>\n\n<iframe src="//evil"></iframe>');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('<iframe');
  });

  it('keeps the markdown a README is actually written in', () => {
    const html = render('# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('keeps images, rewritten through /api/file', () => {
    const html = render('![shot](docs/shot.png)');
    expect(html).toContain('<img');
    expect(html).toContain('path=docs%2Fshot.png');
  });
});
