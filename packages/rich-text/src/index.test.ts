import { describe, expect, it } from 'vitest';
import {
  HTTPS_LINK_REL,
  PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH,
  extractPlainText,
  normalizePublicSiteDescription,
  plainTextToLimitedHtmlDraft,
  sanitizeLimitedHtml,
} from './index.js';

describe('public site rich text sanitizer', () => {
  it('危険なタグ・属性を落とす', () => {
    const sanitized = sanitizeLimitedHtml(
      '<p class="x" style="color:red">本文<script>alert(1)</script><img src=x onerror=alert(1)><strong data-x="1">強調</strong></p>',
    );

    expect(sanitized).toBe('<p>本文<strong>強調</strong></p>');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<img');
    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('class=');
  });

  it('許可されない URL はリンクとして残さない', () => {
    const sanitized = sanitizeLimitedHtml(
      [
        '<a href="javascript:alert(1)">js</a>',
        '<a href="http://example.com">http</a>',
        '<a href="data:text/html,hello">data</a>',
        '<a href="//example.com/path">protocol</a>',
        '<a href="/relative">relative</a>',
      ].join(''),
    );

    expect(sanitized).toBe('jshttpdataprotocolrelative');
    expect(sanitized).not.toContain('<a');
  });

  it('https link には安全属性を付け、mailto link は href だけを残す', () => {
    const sanitized = sanitizeLimitedHtml(
      '<p><a href="https://example.com/path?q=1">site</a><a href="mailto:info@example.com">mail</a></p>',
    );

    expect(sanitized).toContain(
      `<a href="https://example.com/path?q=1" target="_blank" rel="${HTTPS_LINK_REL}">site</a>`,
    );
    expect(sanitized).toContain('<a href="mailto:info@example.com">mail</a>');
  });

  it('plain text は 4000 文字まで保存する', () => {
    const valid = normalizePublicSiteDescription({
      description: 'あ'.repeat(PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH),
      descriptionFormat: 'plain_text',
    });
    expect(valid.description).toHaveLength(PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH);

    expect(() =>
      normalizePublicSiteDescription({
        description: 'あ'.repeat(PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH + 1),
        descriptionFormat: 'plain_text',
      }),
    ).toThrow(/4000/u);
  });

  it('limited HTML は UTF-8 で 12000 bytes まで保存する', () => {
    const validText = 'あ'.repeat(3997);
    const valid = normalizePublicSiteDescription({
      description: `<p>${validText}</p>`,
      descriptionFormat: 'limited_html',
    });
    expect(valid.descriptionFormat).toBe('limited_html');

    expect(() =>
      normalizePublicSiteDescription({
        description: `<p>${'あ'.repeat(4000)}</p>`,
        descriptionFormat: 'limited_html',
      }),
    ).toThrow(/12000 bytes/u);
  });

  it('plain text draft は HTML escape と改行を維持する', () => {
    expect(plainTextToLimitedHtmlDraft('1行目\n2行目\n\n<b>タグ</b>')).toBe(
      '<p>1行目<br>2行目</p><p>&lt;b&gt;タグ&lt;/b&gt;</p>',
    );
    expect(extractPlainText('<p>1行目<br>2行目</p>')).toBe('1行目\n2行目');
  });

  it('空の limited HTML は plain_text の null に正規化する', () => {
    expect(
      normalizePublicSiteDescription({
        description: '<p><br></p><script>alert(1)</script>',
        descriptionFormat: 'limited_html',
      }),
    ).toEqual({ description: null, descriptionFormat: 'plain_text' });
  });
});
