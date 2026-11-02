import { redirect } from 'next/navigation';

// /developers had no data of its own — it re-queried releases,
// forum topics and GitHub Discussions that are already served by /releases,
// /discussions and /code. Folded into /for-ai, the canonical developer/
// machine-access hub.
export default function DevelopersPage() {
  redirect('/for-ai');
}
