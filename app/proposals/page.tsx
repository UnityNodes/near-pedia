import { redirect } from 'next/navigation';

// In nearpedia, "proposals" are GitHub pull requests / issues across the
// NEAR repos (yourchain-node, yourchain-app, CIPs, …). The /code browser is
// their canonical index; individual items render at /proposals/[...slug]
// (linked from search and CIP mentions).
export default function ProposalsIndex() {
  redirect('/code');
}
