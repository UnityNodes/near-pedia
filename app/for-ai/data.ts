import { SITE } from '@/lib/site.config';

export const MCP_URL = `${SITE.url}/mcp`;
export const API_BASE_URL = `${SITE.url}/api/v1`;

export interface ToolItem {
  name: string;
  desc: string;
}

export interface ClientConfig {
  tab: string;
  name: string;
  path: string;
  lang: 'json' | 'yaml' | 'shell';
  code: string;
  note?: string;
}

export interface TroubleshootingItem {
  q: string;
  a: string;
}

export interface RateLimit {
  route: string;
  limit: string;
}

export const MCP_TOOLS_FALLBACK: ToolItem[] = [
  { name: 'check_code', desc: 'Check a NEAR source file or manifest for removed, deprecated or changed APIs and stale dependencies' },
  { name: 'check_deprecation', desc: 'Is this package, API, repo or service still alive, and what replaces it, with evidence' },
  { name: 'resolve_package', desc: 'An npm or crates.io package at a version: latest, yanked, deprecated, replacement' },
  { name: 'get_breaking_changes', desc: 'Removals, deprecations and breaking lines between two versions of a NEAR product' },
  { name: 'explain_error', desc: 'A NEAR error: cause and fix from docs.near.org, plus related deprecations, forum and GitHub' },
  { name: 'find_known_issues', desc: 'Open problems matching a description: unanswered forum threads and open GitHub issues' },
  { name: 'get_protocol_status', desc: 'Protocol version, the validators\' upgrade vote by stake, epoch and upgrade schedule' },
  { name: 'get_doc', desc: 'The full text of one docs page by id' },
  { name: 'search', desc: 'Full-text search across docs, forum, releases, blog and GitHub' },
  { name: 'semantic_search', desc: 'Meaning-based search across every source' },
  { name: 'find_code_examples', desc: 'Code snippets from forum posts on a topic' },
  { name: 'get_standard', desc: 'A NEP standard by number, or found by words' },
  { name: 'get_radar', desc: 'What is changing now and needs action, each alert with its expiry' },
  { name: 'list_proposals', desc: 'House of Stake proposals with their vote standing' },
  { name: 'get_proposal', desc: 'One House of Stake proposal in full' },
  { name: 'list_incidents', desc: 'Security incidents in the NEAR ecosystem' },
  { name: 'get_incident', desc: 'One security incident in full' },
  { name: 'find_project', desc: 'NEAR Catalog projects with TVL, tokens and incidents' },
  { name: 'get_partner', desc: 'A NEAR partner\'s contracts, docs, GitHub and catalog entry' },
  { name: 'get_contract_info', desc: 'What is deployed on an account, live: methods, standards, source metadata' },
  { name: 'get_recent_changes', desc: 'What changed on NEAR in the last N days' },
];

export const IDE_CONFIGS: ClientConfig[] = [
  {
    tab: 'Claude Desktop',
    name: 'Claude Desktop',
    path: '~/Library/Application Support/Claude/claude_desktop_config.json (macOS) · %APPDATA%\\Claude\\claude_desktop_config.json (Windows)',
    lang: 'json',
    code: `{
  "mcpServers": {
    "nearpedia": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`,
    note: 'Claude Desktop expects stdio, not HTTP. mcp-remote bridges the two. A bare "type": "http" entry can silently drop your whole mcpServers block on startup.',
  },
  {
    tab: 'Claude.ai',
    name: 'Claude.ai (web/mobile)',
    path: 'Customize → Connectors → Add custom connector',
    lang: 'shell',
    code: `URL: ${MCP_URL}
Auth: none
Available on Free, Pro, Max, Team and Enterprise plans. Free is limited to one custom connector total.`,
  },
  {
    tab: 'Claude Code',
    name: 'Claude Code CLI',
    path: 'one-liner',
    lang: 'shell',
    code: `claude mcp add --transport http --scope user nearpedia ${MCP_URL}`,
    note: 'Drop --scope user for the default (local, current project only), or use --scope project to share via .mcp.json.',
  },
  {
    tab: 'Cursor',
    name: 'Cursor',
    path: '~/.cursor/mcp.json (global) or .cursor/mcp.json (project)',
    lang: 'json',
    code: `{
  "mcpServers": {
    "nearpedia": {
      "url": "${MCP_URL}"
    }
  }
}`,
  },
  {
    tab: 'Windsurf',
    name: 'Windsurf',
    path: '~/.codeium/windsurf/mcp_config.json',
    lang: 'json',
    code: `{
  "mcpServers": {
    "nearpedia": {
      "serverUrl": "${MCP_URL}"
    }
  }
}`,
    note: 'The field is serverUrl, not url. Windsurf and Cursor use different names for the same thing.',
  },
  {
    tab: 'VS Code',
    name: 'VS Code (Copilot Agent Mode)',
    path: '.vscode/mcp.json (workspace) or user profile',
    lang: 'json',
    code: `{
  "servers": {
    "nearpedia": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`,
  },
  {
    tab: 'Cline',
    name: 'Cline (VS Code extension)',
    path: 'MCP Servers panel → Remote Servers → Streamable HTTP',
    lang: 'json',
    code: `{
  "mcpServers": {
    "nearpedia": {
      "type": "streamableHttp",
      "url": "${MCP_URL}",
      "disabled": false,
      "autoApprove": []
    }
  }
}`,
    note: 'The type field matters here: without it Cline falls back to the legacy SSE transport instead of HTTP.',
  },
  {
    tab: 'Continue',
    name: 'Continue.dev',
    path: '.continue/mcpServers/nearpedia.yaml (agent mode)',
    lang: 'yaml',
    code: `name: ${SITE.name}
version: 0.0.1
schema: v1
mcpServers:
  - name: ${SITE.name}
    type: streamable-http
    url: ${MCP_URL}`,
  },
  {
    tab: 'Zed',
    name: 'Zed',
    path: 'settings.json → context_servers',
    lang: 'json',
    code: `{
  "context_servers": {
    "nearpedia": {
      "url": "${MCP_URL}"
    }
  }
}`,
  },
  {
    tab: 'JetBrains',
    name: 'JetBrains (IntelliJ / PyCharm / WebStorm 2025.2+)',
    path: 'Settings → Tools → AI Assistant → Model Context Protocol → Add server',
    lang: 'shell',
    code: `URL: ${MCP_URL}
Transport: HTTP
Auth: none`,
  },
  {
    tab: 'ChatGPT',
    name: 'ChatGPT (Plus / Pro / Team / Enterprise / Edu)',
    path: 'Settings → Connectors → Advanced settings → enable Developer mode, then Connectors → Create',
    lang: 'shell',
    code: `URL: ${MCP_URL}
Transport: Streamable HTTP
Auth: none
Read-only tools auto-allowed; the server has no write tools.`,
  },
];

export const TROUBLESHOOTING: TroubleshootingItem[] = [
  {
    q: 'Tools don’t show up after adding the server',
    a: 'Claude Code: run /mcp in a session, or claude mcp list to check connection status. VS Code: run "MCP: List Servers" from the command palette to see logs. Cursor / Claude Desktop / Windsurf / Zed: fully quit and reopen the app. Closing the window is not enough.',
  },
  {
    q: 'Claude Desktop config file looks empty after restart',
    a: 'A bare {"type":"http","url":...} entry can cause Claude Desktop to silently drop the whole mcpServers block. Use the mcp-remote bridge form shown above instead, and keep a backup of claude_desktop_config.json before editing it by hand.',
  },
  {
    q: 'Getting 429 Too Many Requests',
    a: 'Check the RateLimit-* response headers for your remaining quota and the Retry-After header for how long to wait. Limits are per IP (see Rate limits below), not per API key. There is no key to upgrade.',
  },
  {
    q: 'Not sure if it’s a client problem or the server is down',
    a: `Test the server directly, outside any client: curl -s ${MCP_URL} -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 200. If that returns JSON starting with {"jsonrpc":"2.0", the server is fine and the issue is in your client config.`,
  },
];

export const RATE_LIMITS: RateLimit[] = [
  { route: '/mcp', limit: '60 req / 15 min per IP' },
  { route: '/api/v1/search', limit: '20 req / min per IP' },
  { route: '/api/v1/*', limit: '120 req / 15 min per IP' },
];

export const REST_EXAMPLES = `curl -X POST ${API_BASE_URL}/check-code -H 'Content-Type: application/json' \\
  -d '{"filename":"contract.ts","code":"import { near } from \\"near-sdk-js\\";"}'
curl '${API_BASE_URL}/deprecations?q=near-lake'
curl '${API_BASE_URL}/protocol?network=mainnet'
curl '${API_BASE_URL}/search?q=meta+transactions&limit=5'`;
