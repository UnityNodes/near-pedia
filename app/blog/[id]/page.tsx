import type { Metadata } from 'next';
import { BlogPostPageContent, getBlogPostMetadata } from '@/components/blog-post-page';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return getBlogPostMetadata(id);
}

export default async function BlogPostPage({ params }: PageProps) {
  const { id } = await params;
  return <BlogPostPageContent id={id} />;
}
