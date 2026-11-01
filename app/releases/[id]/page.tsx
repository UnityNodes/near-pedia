import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ReleasePageContent } from '@/components/release-page';
import { findRelease, getRelease } from '@/lib/releases';
import { SITE } from '@/lib/site.config';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const item = findRelease(id);
  if (!item) return { title: 'Not Found' };
  const url = `${SITE.url}/releases/${item.id}`;
  const description = item.summary || `${item.title}, released on GitHub.`;
  const brandedTitle = `${item.title} | ${SITE.name}`;
  return {
    title: item.title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title: brandedTitle, description, url },
    twitter: { card: 'summary_large_image', title: brandedTitle, description },
  };
}

export default async function ReleasePage({ params }: PageProps) {
  const { id } = await params;
  const detail = getRelease(id);
  if (!detail) notFound();
  if (detail.item.id !== id) permanentRedirect(`/releases/${detail.item.id}`);
  return <ReleasePageContent detail={detail} />;
}
