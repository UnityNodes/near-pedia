/**
 * The tools the public MCP endpoint offers: twelve for code, ten for the
 * ecosystem and five for anyone researching NEAR. The engine this server
 * came from registered 88, and agents picked badly among them. The other
 * handlers stay in the code, reachable over REST and by the standing checks
 * (MCP_TOOLSET=full); each was audited on 2026-11-02 and left out for
 * duplicating a public tool, returning template data or matching loosely.
 */

export const CODE_TOOLS = [
  'check_code', 'check_deprecation', 'resolve_package', 'get_breaking_changes', 'explain_error', 'find_known_issues',
  'get_protocol_status', 'get_doc', 'search', 'semantic_search', 'find_code_examples', 'get_standard',
] as const;

export const ECOSYSTEM_TOOLS = [
  'get_radar', 'list_proposals', 'get_proposal', 'list_incidents', 'get_incident', 'find_project', 'get_partner', 'get_contract_info', 'get_recent_changes',
  'get_discussion',
] as const;

export const EVERYONE_TOOLS = [
  'get_network_state', 'get_validators', 'list_blog_posts', 'get_blog_post', 'list_videos',
] as const;

export const PUBLIC_TOOLS: ReadonlySet<string> = new Set([...CODE_TOOLS, ...ECOSYSTEM_TOOLS, ...EVERYONE_TOOLS]);

/** Which tool names this process registers: the public set, or every one with MCP_TOOLSET=full. */
export function toolFilter(env: Readonly<Record<string, string | undefined>> = process.env): (name: string) => boolean {
  return env.MCP_TOOLSET === 'full' ? () => true : (name) => PUBLIC_TOOLS.has(name);
}
