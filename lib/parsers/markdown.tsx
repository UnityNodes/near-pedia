import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { isValidElement, type ReactNode } from 'react';
import { PdfViewer } from '@/components/pdf-viewer';
import { autolinkCipsMarkdown } from '@/lib/cip-autolink';
import { slugifyHeading } from '@/lib/slug';

interface Props {
  content: string;
  baseUrl?: string;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

export async function MarkdownRenderer({ content, baseUrl }: Props) {
  const prepared = autolinkCipsMarkdown(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        h1: ({ children, node: _node, ...rest }) => <h1 id={slugifyHeading(nodeText(children))} {...rest}>{children}</h1>,
        h2: ({ children, node: _node, ...rest }) => <h2 id={slugifyHeading(nodeText(children))} {...rest}>{children}</h2>,
        h3: ({ children, node: _node, ...rest }) => <h3 id={slugifyHeading(nodeText(children))} {...rest}>{children}</h3>,
        h4: ({ children, node: _node, ...rest }) => <h4 id={slugifyHeading(nodeText(children))} {...rest}>{children}</h4>,
        ...(baseUrl ? {
          a: ({ href, children, node: _node, ...rest }) => {
            const resolved = href && (href.startsWith('/') || !href.startsWith('http'))
              ? `${baseUrl}/${href.replace(/^\//, '')}`
              : href;
            const isPdf = resolved?.toLowerCase().endsWith('.pdf');
            const rawUrl = isPdf && resolved
              ? resolved.replace(
                  'https://github.com/your-org/CIPs/blob/main/',
                  'https://raw.githubusercontent.com/your-org/CIPs/main/'
                )
              : null;
            const filename = rawUrl
              ? decodeURIComponent(rawUrl.split('/').pop() ?? 'document.pdf')
              : '';
            const link = <a href={resolved} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
            // Only a PDF link needs a block wrapper, to give the viewer below
            // it its own line. Every other link is inline prose - CIP bodies
            // reference other CIPs and PRs mid-sentence ("Forwarding ([CIP-45]
            // (...)): custom IGP hooks ([yourchain-app#7526](...))..."), and
            // forcing display:block on the span here put every one of those
            // links on its own line, scattering the surrounding punctuation
            // across the page instead of reading as a sentence.
            if (!rawUrl) return link;
            return (
              <span style={{ display: 'block', marginBottom: '4px' }}>
                {link}
                <PdfViewer url={rawUrl} filename={filename} />
              </span>
            );
          },
        } : {}),
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}
