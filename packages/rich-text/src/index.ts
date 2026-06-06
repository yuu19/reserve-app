import sanitizeHtml from 'sanitize-html';

export const PUBLIC_SITE_DESCRIPTION_FORMATS = ['plain_text', 'limited_html'] as const;

export type PublicSiteDescriptionFormat = (typeof PUBLIC_SITE_DESCRIPTION_FORMATS)[number];

export const PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH = 4000;
export const PUBLIC_SITE_DESCRIPTION_HTML_MAX_BYTES = 12000;
export const HTTPS_LINK_REL = 'nofollow noopener noreferrer';

export class PublicSiteDescriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicSiteDescriptionValidationError';
  }
}

type NormalizePublicSiteDescriptionInput = {
  description?: string | null;
  descriptionFormat?: PublicSiteDescriptionFormat | null;
  currentDescription?: string | null;
  currentDescriptionFormat?: PublicSiteDescriptionFormat | null;
};

type NormalizedPublicSiteDescription = {
  description: string | null;
  descriptionFormat: PublicSiteDescriptionFormat;
};

const allowedTags = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'];
const textEncoder = new TextEncoder();

const isPublicSiteDescriptionFormat = (
  value: unknown,
): value is PublicSiteDescriptionFormat =>
  value === 'plain_text' || value === 'limited_html';

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const utf8ByteLength = (value: string): number => textEncoder.encode(value).byteLength;

const countCharacters = (value: string): number => Array.from(value).length;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeAllowedHref = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    return null;
  }

  return url.toString();
};

const assertPlainTextLength = (value: string): void => {
  if (countCharacters(value) > PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH) {
    throw new PublicSiteDescriptionValidationError(
      `Description plain text must be ${PUBLIC_SITE_DESCRIPTION_PLAIN_TEXT_MAX_LENGTH} characters or fewer.`,
    );
  }
};

const assertHtmlByteLength = (value: string): void => {
  if (utf8ByteLength(value) > PUBLIC_SITE_DESCRIPTION_HTML_MAX_BYTES) {
    throw new PublicSiteDescriptionValidationError(
      `Description HTML must be ${PUBLIC_SITE_DESCRIPTION_HTML_MAX_BYTES} bytes or fewer.`,
    );
  }
};

export const sanitizeLimitedHtml = (value: string): string => {
  return sanitizeHtml(normalizeLineEndings(value), {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attribs) => {
        const href = normalizeAllowedHref(attribs.href);
        if (!href) {
          return { tagName: 'a', attribs: {} as Record<string, string> };
        }
        if (href.startsWith('mailto:')) {
          return { tagName: 'a', attribs: { href } as Record<string, string> };
        }
        return {
          tagName: 'a',
          attribs: {
            href,
            target: '_blank',
            rel: HTTPS_LINK_REL,
          },
        };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === 'a' && !frame.attribs.href) {
        return 'excludeTag';
      }
      return false;
    },
  }).trim();
};

export const extractPlainText = (value: string): string => {
  const textWithBreaks = normalizeLineEndings(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol)>/gi, '\n');
  return sanitizeHtml(textWithBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const plainTextToLimitedHtmlDraft = (value: string): string => {
  const normalized = normalizeLineEndings(value).trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
};

export const normalizePublicSiteDescription = ({
  description,
  descriptionFormat,
  currentDescription = null,
  currentDescriptionFormat = 'plain_text',
}: NormalizePublicSiteDescriptionInput): NormalizedPublicSiteDescription => {
  const fallbackFormat = isPublicSiteDescriptionFormat(currentDescriptionFormat)
    ? currentDescriptionFormat
    : 'plain_text';

  if (description === undefined) {
    return {
      description: currentDescription ?? null,
      descriptionFormat: currentDescription ? fallbackFormat : 'plain_text',
    };
  }

  const nextFormat = descriptionFormat ?? fallbackFormat;
  if (!isPublicSiteDescriptionFormat(nextFormat)) {
    throw new PublicSiteDescriptionValidationError('Unknown description format.');
  }

  if (nextFormat === 'plain_text') {
    const plainText = normalizeLineEndings(description ?? '').trim();
    if (!plainText) {
      return { description: null, descriptionFormat: 'plain_text' };
    }
    assertPlainTextLength(plainText);
    return { description: plainText, descriptionFormat: 'plain_text' };
  }

  const sanitizedHtml = sanitizeLimitedHtml(description ?? '');
  const plainText = extractPlainText(sanitizedHtml);
  if (!plainText) {
    return { description: null, descriptionFormat: 'plain_text' };
  }
  assertPlainTextLength(plainText);
  assertHtmlByteLength(sanitizedHtml);
  return { description: sanitizedHtml, descriptionFormat: 'limited_html' };
};
