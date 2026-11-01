export const RELEASE_REPOS = [
  'your-org/yourchain-app',
  'your-org/yourchain-node',
  'your-org/yourchain-core',
  'your-org/yourchain-openrpc',
  'your-org/yoursdk',
] as const;

export function repoName(repo: string): string {
  return repo.split('/')[1] ?? repo;
}
