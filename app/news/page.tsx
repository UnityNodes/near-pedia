import { permanentRedirect } from 'next/navigation';

// Every editorial post NEAR publishes carries both the `blog` and `news`
// tags, so /news listed exactly the same 69 posts as /blog - two URLs for one
// set, and the /news copies shipped no rel=canonical. /blog is the canonical
// index; the merged cross-source view lives at /feed. Same shape as
// /proposals, which redirects to /code.
export default function NewsIndex() {
  permanentRedirect('/blog');
}
