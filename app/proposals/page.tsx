import { redirect } from 'next/navigation';

// In nearpedia, "proposals" are GitHub pull requests / issues across the
// NEAR repos. The /code browser is their canonical index; individual items
// render at /proposals/[...slug] (linked from search).
export default function ProposalsIndex() {
  redirect('/code');
}
