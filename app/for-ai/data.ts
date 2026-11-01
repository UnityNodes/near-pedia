export const MCP_URL = 'https://yourpedia.example/mcp';
export const API_BASE_URL = 'https://yourpedia.example/api/v1';

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
  { name: 'search', desc: 'Keyword/full-text search across the YourChain knowledge base' },
  { name: 'semantic_search', desc: 'Meaning-based (vector + rerank) search across all YourChain sources, incl. YouTube transcripts' },
  { name: 'get_cip', desc: 'Get the full text of a Chain Improvement Proposal by id' },
  { name: 'list_cips', desc: 'List CIPs with status/type filters' },
  { name: 'get_cip_history', desc: 'CIP status-change timeline' },
  { name: 'get_cip_attachments', desc: 'List file/PDF attachments for a CIP' },
  { name: 'get_cip_mentions', desc: 'Where a CIP is referenced: forum, blog, proposals, sibling CIPs' },
  { name: 'get_discussion', desc: 'Get a YourChain forum thread with posts' },
  { name: 'get_doc', desc: 'Get the full text of a YourChain documentation page by id' },
  { name: 'get_whitepaper', desc: 'Get a YourChain whitepaper by slug' },
  { name: 'list_whitepapers', desc: 'List indexed YourChain whitepapers' },
  { name: 'get_trending', desc: 'Trending YourChain content this week' },
  { name: 'get_recent_changes', desc: 'Unified activity stream: CIP transitions, forum, blog, releases' },
  { name: 'get_network_stats', desc: 'Counts of indexed YourChain content (catalog coverage)' },
  { name: 'get_network_state', desc: 'LIVE YourChain on-chain state + TKN market (Explorer + CoinGecko): height, TKN supply, validators, data size, price' },
  { name: 'list_ecosystem_projects', desc: 'YourChain ecosystem project catalog' },
  { name: 'list_repos', desc: 'List GitHub repositories indexed for YourChain' },
  { name: 'list_github_discussions', desc: 'List GitHub Discussions from YourChain repos (your-org/docs Q&A, Ideas)' },
  { name: 'get_github_discussion', desc: 'Get a GitHub Discussion with body and comments' },
  { name: 'get_video', desc: 'Get a cached YourChain YouTube video (metadata + transcript)' },
  { name: 'list_videos', desc: 'Browse cached YourChain YouTube videos by channel / date / transcript' },
  { name: 'list_blog_posts', desc: 'List blog posts, news and press releases, or search them, one tab at a time' },
  { name: 'get_blog_post', desc: 'Read one blog post; reprints and partner press come as an excerpt with a link' },
  { name: 'get_foundation_info', desc: 'YourChain Foundation + Labs leadership and team: names, roles, background' },
  { name: 'get_started_guide', desc: 'Personalized onboarding to build on YourChain (rollup_dev, node_operator, app_dev, researcher, new_to_yourchain)' },
];

export const IDE_CONFIGS: ClientConfig[] = [
  {
    tab: 'Claude Desktop',
    name: 'Claude Desktop',
    path: '~/Library/Application Support/Claude/claude_desktop_config.json (macOS) · %APPDATA%\\Claude\\claude_desktop_config.json (Windows)',
    lang: 'json',
    code: `{
  "mcpServers": {
    "yourpedia": {
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
    code: `claude mcp add --transport http --scope user yourpedia ${MCP_URL}`,
    note: 'Drop --scope user for the default (local, current project only), or use --scope project to share via .mcp.json.',
  },
  {
    tab: 'Cursor',
    name: 'Cursor',
    path: '~/.cursor/mcp.json (global) or .cursor/mcp.json (project)',
    lang: 'json',
    code: `{
  "mcpServers": {
    "yourpedia": {
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
    "yourpedia": {
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
    "yourpedia": {
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
    "yourpedia": {
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
    path: '.continue/mcpServers/yourpedia.yaml (agent mode)',
    lang: 'yaml',
    code: `name: YOURPEDIA
version: 0.0.1
schema: v1
mcpServers:
  - name: YOURPEDIA
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
    "yourpedia": {
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

export const REST_EXAMPLES = `curl ${API_BASE_URL}/search?q=governance&limit=5
curl ${API_BASE_URL}/cips/0042
curl ${API_BASE_URL}/trending`;
