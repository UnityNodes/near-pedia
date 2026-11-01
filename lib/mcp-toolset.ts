/**
 * The tools the public MCP endpoint offers: twelve for code, nine for the
 * ecosystem. The engine this server came from registered 88, and agents
 * picked badly among them; every other handler stays in the code, reachable
 * over REST and by the standing checks, which start their scratch server
 * with MCP_TOOLSET=full.
 */

export const CODE_TOOLS = [
  'check_code', 'check_deprecation', 'resolve_package', 'get_breaking_changes', 'explain_error', 'find_known_issues',
  'get_protocol_status', 'get_doc', 'search', 'semantic_search', 'find_code_examples', 'get_standard',
] as const;

export const ECOSYSTEM_TOOLS = [
  'get_radar', 'list_proposals', 'get_proposal', 'list_incidents', 'get_incident', 'find_project', 'get_partner', 'get_contract_info', 'get_recent_changes',
] as const;

export const PUBLIC_TOOLS: ReadonlySet<string> = new Set([...CODE_TOOLS, ...ECOSYSTEM_TOOLS]);

/** Which tool names this process registers: the public set, or every one with MCP_TOOLSET=full. */
export function toolFilter(env: Readonly<Record<string, string | undefined>> = process.env): (name: string) => boolean {
  return env.MCP_TOOLSET === 'full' ? () => true : (name) => PUBLIC_TOOLS.has(name);
}
