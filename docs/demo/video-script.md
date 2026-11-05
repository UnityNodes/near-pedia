# Demo video (81 s)

Eight scenes at 1920×1080. The voice is Piper (`en_US-ryan-high`); every line is also on screen, so the video works muted. Scenes 4–7 are the live sites, recorded on 2026-11-05.

| # | Seconds | On screen | Voice |
| - | - | - | - |
| 1 | 0–6 | "Ask an AI agent to build on NEAR. → it writes code from 2023." | Ask an AI agent to build on NEAR, and it writes code from two years ago. |
| 2 | 6–18 | A 2023 relayer: `rpc.testnet.pagoda.co`, `keyStores`, `WalletConnection`, `broadcast_tx_commit`, each line marked removed or deprecated | Pagoda's RPC is gone. keyStores and WalletConnection left near-api-js. broadcast_tx_commit is deprecated. The code looks right, and it breaks. |
| 3 | 18–28 | `curl near-pedia.xyz/api/v1/check-code` with each finding, its replacement and source; "the same answer over MCP: check_code" | NEARpedia knows what NEAR changed. One call to check_code names every stale line, what replaces it, and where that is written. |
| 4 | 28–39.5 | near-pedia.xyz/deprecations, scrolling | A hundred and thirty-six entries, built from archived repositories, release notes, package registries and the docs' own markers. Each one links its evidence. |
| 5 | 39.5–48.5 | near-pedia.xyz/protocol, scrolling | It reads the chain too: the protocol version, the upgrade vote and its stake, refreshed every fifteen minutes. |
| 6 | 48.5–62.5 | near-pedia.xyz/ask: "What replaced keyStores in near-api-js 7?" answered live, with sources and "Verified" | Ask in plain words. A model in a TEE on NEAR AI Cloud answers from these sources, cites them, and signs the reply. |
| 7 | 62.5–73 | market.near.ai/a/nearpedia-migrator | On NEAR Agent Market, hire the NEARpedia Migrator. Send a GitHub repository, get back a report and a patch it checked before sending. |
| 8 | 73–81 | `claude mcp add --transport http nearpedia https://near-pedia.xyz/mcp`; 27 MCP tools · 136 deprecations · no key; near-pedia.xyz · github.com/UnityNodes/near-pedia · market.near.ai/a/nearpedia-migrator | Twenty-seven MCP tools, no key. Add NEARpedia to your agent, and build on the NEAR of today. |

Scene 3 shows the findings `check_code` returns for the relayer in scene 2; the counts in scenes 4 and 8 are the live ones on the recording date.
