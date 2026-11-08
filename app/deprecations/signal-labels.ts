import type { Signal } from '@/lib/deprecation-types';

const SIGNAL_LABEL: Record<Signal, string> = {
  repo_archived: 'Repository archived',
  readme_notice: 'README notice',
  registry_flag: 'Registry flag (deprecated or yanked)',
  release_removal: 'Removed in a release',
  docs_marker: 'Marked in the docs',
  docs_removed: 'Docs page removed',
  dormant_with_successor: 'Dormant with a live successor',
  docs_statement: 'Stated in the docs',
  governance: 'Governance decision',
  ecosystem_list: 'Ecosystem listing',
  probe: 'Checked in the published package',
  registry_activity: 'Registry activity',
};

export function signalLabel(signal: string): string {
  return (SIGNAL_LABEL as Record<string, string>)[signal] ?? signal;
}
