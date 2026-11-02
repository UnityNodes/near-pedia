# Distribution

Where NEAR-pedia is listed so agents find it, and what each listing needs.
Every step that publishes something is done only after the maintainers say yes;
the files are ready in this repository before then.

All of them carry `near-pedia.xyz`, the placeholder of the domain (see
CLAUDE.md); replace it with the real one everywhere at once.

## 1. One command, no listing

```bash
claude mcp add --transport http nearpedia https://near-pedia.xyz/mcp
```

Codex, Cursor and other clients: the configurations on `/for-ai`.

## 2. Official MCP Registry

`server.json` at the repository root (schema 2025-12-11): name
`io.github.UnityNodes/nearpedia`, one remote, Streamable HTTP. The
`io.github.<owner>/` namespace is proven by logging in to the publisher with
the GitHub account that owns the repository, so the repository has to be
public first.

```bash
mcp-publisher login github
mcp-publisher publish
```

`version` in `server.json` is set to the release tag being published
(`git tag --sort=-v:refname | head -1`), never edited by hand between
releases.

## 3. Claude Code plugin

The repository is its own plugin marketplace: `.claude-plugin/marketplace.json`
lists the plugin in `plugin/`, which bundles the MCP server and the
`near-current` skill (check before writing NEAR code, check_code after).

```bash
claude plugin marketplace add UnityNodes/nearpedia
claude plugin install nearpedia@nearpedia
```

Before it is announced: `claude plugin validate ./plugin` and
`claude plugin validate .` from the repository root (the format was checked
against code.claude.com/docs on 2026-11-01; the CLI was not on the build box).

## 4. IronClaw registry

A pull request to nearai/ironclaw adding
`registry/mcp-servers/nearpedia.json`, the file in
`docs/distribution/ironclaw-nearpedia.json`, in the same shape as the
entries already there (`linear.json`, `nearai.json`). Those set
`"auth": "dcr"`; NEAR-pedia needs no auth, and IronClaw's hosted-MCP code
defaults to `NoAuth`, so the field is left out. Confirm that against their
registry loader, or ask in the PR, before opening it.

## 5. llms.txt and SKILL.md

`public/llms.txt` describes the tools and the REST API for crawlers and
agents; `plugin/skills/near-current/SKILL.md` is the skill, usable on its
own by any agent that reads skills.
