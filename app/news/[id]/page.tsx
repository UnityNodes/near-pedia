import { permanentRedirect } from 'next/navigation';

// Kept so existing /news/<id> links keep resolving; the post itself is
// canonical at /blog/<id>. See app/news/page.tsx for why.
export default async function NewsPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/blog/${id}`);
}
