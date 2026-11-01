# pedia-template

A knowledge-hub site you point at one ecosystem. It pulls proposals, docs, forum threads, blog posts, releases, papers, videos and code activity into one SQLite database, keeps it fresh from cron, and serves it three ways: a web UI, a REST API and an MCP server for AI agents.

Everything in this repository is written against placeholders. Replace them and point the sync scripts at your own sources to get your own site. [`RESKIN.md`](RESKIN.md) is the step-by-step guide, and [`docs/template/`](docs/template/README.md) documents every page, component, data flow and MCP tool.

## Placeholders

| Placeholder | Stands for |
|---|---|
| `yourpedia`, `YourPedia`, `YOURPEDIA` | your product name |
| `yourpedia.example` | your domain |
| `YourChain`, `yourchain` | the ecosystem the site is about |
| `your-org` | your GitHub organisation |
| `Your Organization`, `example.com`, `@your-handle` | the publisher |
| `TKN` | the ecosystem's token symbol |

Find every one with `grep -rIn "yourpedia\|YourChain\|your-org\|example\.com\|TKN" --exclude-dir=node_modules --exclude-dir=.next .`.

## What you get

- **Content pages** for improvement proposals (`/cips`), documentation, forum threads, blog and news, release notes, whitepapers, videos, ecosystem projects, code issues and pull requests, a radar of alerts, a weekly digest and a trending list.
- **Search** across all of it: SQLite FTS5 for keywords, `sqlite-vec` embeddings for meaning, an optional Cohere rerank.
- **An MCP server** (`mcp-server.ts`, Express, port 3041) and a **REST API** under `/api/v1`, both reading the same database, with an OpenAPI spec and an interactive reference.
- **A sync engine**: one script per source in `scripts/sync-*.ts`, run from cron by `deploy/sync-tick.sh`, every run logged to `sync_log`.
- **Standing checks**: `scripts/check-*.ts` compare what the site serves with what the data says, and run nightly.

## Quick start

Node 22 is required (`better-sqlite3` is built against its ABI, see `.nvmrc`).

```bash
npm install
cp .env.example .env.production      # fill in keys; never commit it
npm run db:init                      # creates data/cips.db
npm run build && npm run start       # web UI on :3040
npx tsx mcp-server.ts                # MCP + REST on :3041
```

Every `sync-*` script has its source URLs at the top and they all point at placeholder hosts. Edit them for your ecosystem before running `npm run sync:cips` or the others; until then the site renders empty pages by design. [`docs/template/quick-start.md`](docs/template/quick-start.md) lists three ways to get from a clone to a populated site.

## Layout

```
app/            Next.js pages and route handlers
components/     UI components
lib/            database client, search, ranking, embeddings, parsers, shared helpers
scripts/        sync-*.ts (one per source), check-*.ts, backfills
mcp-server.ts   MCP server and REST API v1
deploy/         systemd units, Caddyfile, sync-tick.sh, sync-cf.sh, git hooks
docs/           architecture notes and the template guides
tests/          Vitest
```

## Keeping a project current with this template

A project made from this template is a copy, not a fork: later changes here do not reach it. `scripts/check-template.ts` compares the files listed in `lib/template-manifest.ts` with a copy of this repository and reports drift; it changes nothing. Bring updates across by hand.

## Resources page

`/resources` is a short list of links you would send to a colleague. The list lives in `lib/resources.ts`: each entry has a section, a group, a title, a URL, one plain sentence, the page title the URL should show (`expect`, a regular expression) and the date you last checked it by hand (`verifiedAt`). Replace the example entries with your own links, and set `verifiedAt` to the day you checked them. Sites that block bots can be marked `unverifiable: true`.

### The weekly check

Every Monday `scripts/check-resources.ts` checks everything the page shows and reports through the same failure alerts as every other source:

- every external link: a status that is not 2xx, a redirect to somewhere else, or a page title that no longer matches `expect`;
- every internal link, including the ones the page itself draws from `PAGE_LINKS`: a link with no page behind it;
- every line in `LEARN_FACTS` (empty by default): the source must still be reachable and must still say the evidence phrase;
- any entry not re-verified for 90 days.

A test fails if the page or the browser component links to an internal path that is not in `RESOURCES` or `PAGE_LINKS`, or hard-codes an external link, so nothing on the page can escape the check.

### Facts with a source

`LEARN_FACTS` fills the block above the Learn links (its title is `FACTS_TITLE`). Each fact is one plain sentence in your own words, the page that backs it (`url`), the phrase that page must contain (`evidence`, a regular expression, at least 12 characters) and `verifiedAt`. If the source is rendered by script, point `evidenceUrl` at a plain-text version of it (documentation sites often serve one) and keep `url` for readers. Write only what a primary source states, and leave out numbers that change.

### Icons

Icons come from `lucide-react` (ISC license, already a dependency). `components/resources-icons.tsx` maps each section to an icon and each link kind to an icon. A link kind (Docs, Code, Video, Forum, Chat, This site) is worked out from the host by `linkKind` in `lib/resources.ts`. To add a kind, extend `LinkKind`, add a rule to `linkKind` and an entry to the icon map; the TypeScript compiler points at every place that must change.

### Animations

Two animations ship, both from LottieFiles, used unchanged under the Lottie Simple License. `public/animations/search.json` is the magnifier shown when the filter finds nothing ("Free Search Animation" by Fernando Ron Pedrique). `public/animations/check-success.json` is the green check that draws itself when the contact form is sent ("Check Mark - Success" by Travis Gregory). Commercial use is allowed and credit is optional, and the license asks that files taken from it keep the same license, so `public/animations/CREDITS.txt` stays next to the files.

One component, `components/lottie-icon.tsx`, plays them. It loads the player (`lottie-web`, MIT, the light build) and the JSON only when it is rendered, and a visitor who prefers reduced motion gets a still frame. `EmptyAnimation` and `SuccessAnimation` are thin wrappers around it. Delete a wrapper and its use to drop that animation.

To add another animation, take it from a source whose license you have read for that file, self-host the JSON instead of loading it from a CDN, add its entry to `CREDITS.txt` and render it through `LottieIcon`. A test checks that every file in `public/animations` is small and carries no expressions, embedded images or external URLs, that each one is credited, and that the player is imported in exactly one place. Keep animation for states that tell the visitor something (nothing found, sent). A list of rows with one player each is slow and tiring. Check your Content-Security-Policy before choosing a player: the `lottie-web` light build is plain script, while a WebAssembly player needs `wasm-unsafe-eval`.

## License

No `LICENSE` file is checked in and `package.json` is marked private. Treat the code as all rights reserved until one is added.
