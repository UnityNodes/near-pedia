import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { AppProvider } from '@/components/app-context';
import { Topbar } from '@/components/topbar';
import { SiteFooter } from '@/components/site-footer';
import { ThemeInit } from '@/components/theme-init';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { JsonLd } from '@/components/json-ld';
import { SITE, SITE_TITLE } from '@/lib/site.config';
import './globals.css';
import './design.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const SITE_DESCRIPTION = SITE.description;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0B0C',
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url),
  // title.template appends " | <SITE.name>" to every page that sets a bare title.
  // Per-page metadata MUST use bare titles (e.g. "Docs") — never include the
  // brand suffix manually, or it doubles.
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE.name}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    title: SITE.name,
    statusBarStyle: 'black-translucent',
  },
  alternates: {
    types: {
      'application/atom+xml': [
        { url: '/api/feed/forum', title: `${SITE.name} · Discussions` },
        { url: '/api/feed/pulse', title: `${SITE.name} · Pulse` },
        { url: '/api/feed/blog', title: `${SITE.name} · Blog & News` },
        { url: '/api/feed/releases', title: `${SITE.name} · GitHub Releases` },
        { url: '/api/feed/github-discussions', title: `${SITE.name} · GitHub Discussions` },
      ],
    },
  },
};

const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE.name,
  alternateName: SITE.tagline,
  url: SITE.url,
  description: SITE.description,
  about: {
    '@type': 'Thing',
    name: 'NEAR',
    description: 'NEAR Protocol, a sharded proof-of-stake layer-1 blockchain.',
    url: 'https://near.org',
    sameAs: [
      'https://en.wikipedia.org/wiki/NEAR_Protocol',
      'https://github.com/near',
    ],
  },
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/search?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
  publisher: {
    '@type': 'Organization',
    name: SITE.publisher.name,
    url: SITE.publisher.url,
    sameAs: [SITE.publisher.twitter],
  },
};

// Standalone Organization schema - Google docs recommend emitting
// this separately from WebSite for proper Knowledge Graph linkage.
const ORGANIZATION_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE.name,
  alternateName: SITE.tagline,
  url: SITE.url,
  logo: `${SITE.url}${SITE.logo.icon}`,
  description: `${SITE.name} is the central knowledge hub for the NEAR ecosystem.`,
  sameAs: [
    SITE.repo,
  ],
  parentOrganization: {
    '@type': 'Organization',
    name: SITE.publisher.name,
    url: SITE.publisher.url,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeInit />
        {/* No preconnect to Google Fonts: the typefaces are self-hosted through
            next/font (spaceGrotesk, jetbrainsMono) and nothing on the site loads
            from googleapis at runtime. Dead hints like these generated CSP
            report noise once, when an external audit found them alongside a
            genuinely blocked stylesheet request. */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://img.youtube.com" />
        <JsonLd payload={[WEBSITE_SCHEMA, ORGANIZATION_SCHEMA]} />
      </head>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`} style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <a href="#main-content" className="skip-to-content">Skip to content</a>
        <ServiceWorkerRegister />
        <AppProvider>
          <Topbar />
          <div id="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {children}
          </div>
          <SiteFooter />
        </AppProvider>
      </body>
    </html>
  );
}
