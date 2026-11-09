# Distribution

Where NEARpedia is listed so agents find it, and what each listing needs.
All of them carry the production domain, `near-pedia.xyz`.

| Where | State |
| - | - |
| One command, any MCP client | works; configurations on `/for-ai` |
| Official MCP Registry | listed since 2026-11-05 as `io.github.UnityNodes/near-pedia` |
| Claude Code plugin marketplace | this repository; validates |
| Claude directory | MCP connector submitted 2026-11-05, in review; plugin not submitted |
| IronClaw registry | file prepared, not submitted |
| `llms.txt`, `SKILL.md` | served |

## 1. One command, no listing

```bash
claude mcp add --transport http nearpedia https://near-pedia.xyz/mcp
```

Claude.ai and ChatGPT add the same URL as a custom connector, with no
install. Codex, Cursor and the other clients: the configurations on
`/for-ai`.

## 2. Official MCP Registry

Listed since 2026-11-05:

```bash
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=near-pedia'
```

`server.json` at the repository root (schema 2025-12-11): name
`io.github.UnityNodes/near-pedia`, one remote, Streamable HTTP, and icons
served from the site (`tests/lib/server-json.test.ts` checks each one is a
file in `public/` with the declared type and size). The
`io.github.UnityNodes/` namespace belongs to the organisation, so the
publisher must log in as one of its Owners with a credential that can read
the organisation role. The interactive `mcp-publisher login github` cannot;
a classic personal access token with only `read:org` can, and so can a
GitHub Actions run (OIDC):

```bash
mcp-publisher login github --token <classic PAT, read:org>
mcp-publisher publish
mcp-publisher logout
```

`version` in `server.json` is set to the release tag being published
(`git tag --sort=-v:refname | head -1`), never edited by hand between
releases.

## 3. Claude Code plugin

The repository is its own plugin marketplace: `.claude-plugin/marketplace.json`
lists the plugin in `plugin/`, which bundles the MCP server and the
`near-current` skill (check before writing NEAR code, check_code after).

```
/plugin install nearpedia --marketplace UnityNodes/near-pedia
```

`claude plugin validate ./plugin` and `claude plugin validate .` pass. The
plugin carries the icon (`plugin/.claude-plugin/icon.png`, 512 px) and the
privacy policy URL the plugin directory asks for; it has no `version`, so
installs follow the repository's commits.

The Claude directory is a separate, reviewed listing submitted from
https://claude.ai/directory/manage. The MCP connector (`https://near-pedia.xyz/mcp`,
no authentication, read only) was submitted on 2026-11-05; review takes weeks.
The plugin can be submitted from the same portal and linked to the connector.

## 4. IronClaw registry

`docs/distribution/ironclaw-nearpedia.json` is an entry in the shape of
`nearai/ironclaw`'s `registry/mcp-servers/*.json` (`linear.json`,
`nearai.json`). Those set `"auth": "dcr"`; NEARpedia needs no auth, so the
field is left out.

Not submitted. As of 2026-11-05 that registry has only ever been changed by
the IronClaw team (the move to JSON manifests and the NEAR AI server), and a
pull request letting credential-free hosted servers dispatch in its new
runtime is still open. Ask the IronClaw maintainers whether they take outside
servers before opening a pull request.

## 5. llms.txt and SKILL.md

`public/llms.txt` describes the tools and the REST API for crawlers and
agents; `plugin/skills/near-current/SKILL.md` is the skill, usable on its
own by any agent that reads skills.
