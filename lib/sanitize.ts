import sanitizeHtml from 'sanitize-html';
import { autolinkCips } from './cip-autolink';

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'del',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'hr', 'details', 'summary',
];

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  'a': ['href', 'title', 'target', 'rel'],
  'img': ['src', 'alt', 'width', 'height'],
  'code': ['class'],
  'pre': ['class'],
  'div': ['class'],
  'span': ['class'],
  'td': ['colspan', 'rowspan'],
  'th': ['colspan', 'rowspan'],
};

export function sanitizeDocHtml(html: string): string {
  return autolinkCips(sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS, 'figure', 'figcaption', 'section', 'article', 'nav', 'aside', 'caption', 'colgroup', 'col'],
    allowedAttributes: {
      ...ALLOWED_ATTRS,
      'img': ['src', 'alt', 'width', 'height', 'loading', 'class'],
      'a': ['href', 'title', 'target', 'rel', 'class'],
      'table': ['class'],
      'section': ['class', 'id'],
      'div': ['class', 'id'],
      'span': ['class', 'id'],
      'h1': ['id'], 'h2': ['id'], 'h3': ['id'], 'h4': ['id'],
    },
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
      'img': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: 'lazy' },
      }),
    },
  }), { skipInsideTags: true });
}

export function sanitizeDiscourseHtml(html: string): string {
  return autolinkCips(sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  }), { skipInsideTags: true });
}
