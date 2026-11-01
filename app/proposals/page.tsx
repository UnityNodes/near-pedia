import { redirect } from 'next/navigation';

// In yourpedia, "proposals" are GitHub pull requests / issues across the
// YourChain repos (yourchain-node, yourchain-app, CIPs, …). The /code browser is
// their canonical index; individual items render at /proposals/[...slug]
// (linked from search and CIP mentions).
export default function ProposalsIndex() {
  redirect('/code');
}
