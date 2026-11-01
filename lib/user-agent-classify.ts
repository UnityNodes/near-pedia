/**
 * Lightweight User-Agent classification for analytics.
 *
 * Categories - deliberately coarse, picked to answer questions like
 * "how many of yesterday's chat requests came from GPTBot vs humans".
 *
 *   ai_bot     - declared LLM/AI crawlers (GPTBot, ClaudeBot, Perplexity,
 *                Google-Extended, Gemini-Extended, anthropic-ai, cohere-ai…)
 *   ai_runtime - runtime fetches from Claude.ai / ChatGPT browse, MCP clients
 *   search_bot - classic search crawlers (Googlebot, Bingbot, DuckDuckBot…)
 *   headless   - a real browser engine driven by automation (HeadlessChrome,
 *                Puppeteer, Playwright, Selenium…)
 *   script     - curl/wget/python-requests/Postman etc.
 *   human      - anything that looks like a real browser
 *   unknown    - a User-Agent we were given but cannot place
 *
 * WHY A MISSING HEADER IS `script` AND NOT `unknown`. Those are two different
 * facts and only one of them is ambiguous. "I sent you a UA string you don't
 * recognise" leaves room for a browser we have never seen; "I sent no UA header
 * at all" does not, because no browser omits it. Yet both landed in `unknown`,
 * and `unknown` is counted as a person by usage-counters and /metrics.
 *
 * That is how 147 visitor records with no user-agent, no IP and no referrer came
 * to sit inside the human total: the test suite generated some of them by
 * calling middleware() against the live host, and something else, still
 * unidentified, generated bursts of the rest. The classifier could not tell
 * either apart from a person, and it is the classifier's job to.
 *
 * Routing the absent case to the existing `script` excludes it everywhere at
 * once, because every consumer filters to ('human','unknown').
 *
 * WHY `headless` EXISTS. It used to fall through to `human`, because
 * "HeadlessChrome/148.0.7778.96" contains the substring Chrome and HUMAN_RE
 * matched it. That was not a rounding error: of 47,639 visits recorded as human,
 * 44,977 were HeadlessChrome, so 94% of the site's headline "human visits"
 * number was automation. /status reported 42,637 people in 24 hours against
 * 45,698 for all time on /metrics, and both were the same fiction.
 *
 * It is its own class rather than folded into `script` because 44k automated
 * browser visits is a fact worth being able to see, and because every consumer
 * either groups by this column or filters to ('human','unknown'), so a new value
 * is excluded from the human counts automatically.
 *
 * Pure function; no DOM, no DB. Suitable for the edge.
 */

export type AgentClass = 'ai_bot' | 'ai_runtime' | 'search_bot' | 'headless' | 'script' | 'human' | 'unknown';

const AI_BOT_RE = /\b(GPTBot|ChatGPT-User|OAI-SearchBot|PerplexityBot|ClaudeBot|anthropic-ai|Google-Extended|Gemini-Extended|cohere-ai|Applebot-Extended|Meta-ExternalAgent|Bytespider|Diffbot)\b/i;
const AI_RUNTIME_RE = /(\bChatGPT\/|\bClaude\b|\bAnthropic\b|@modelcontextprotocol|\bmcp-client\b|\bllama-?index\b|\blangchain\b)/i;
const SEARCH_BOT_RE = /\b(Googlebot|Bingbot|DuckDuckBot|Slurp|YandexBot|Baiduspider|FacebookExternalHit|Twitterbot|LinkedInBot|TelegramBot|WhatsApp|Discordbot)\b/i;
const SCRIPT_RE = /\b(curl|Wget|python-requests|httpie|Go-http-client|libwww-perl|Postman[a-zA-Z]*|node-fetch|axios|undici|okhttp|node|deno|insomnia)\b/i;
// Automation driving a real browser engine. Every one of these carries a browser
// family string too, which is exactly why it has to be tested first.
const HEADLESS_RE = /\b(HeadlessChrome|Headless|Puppeteer|Playwright|Selenium|WebDriver|PhantomJS|HtmlUnit|jsdom|Cypress|Chrome-Lighthouse|Electron)\b/i;

// The long tail of crawlers that name themselves but are not in the lists above.
// The +url convention is part of the robots etiquette: a UA carrying a contact
// URL is declaring itself a bot.
const GENERIC_BOT_RE = /(\bbot\b|\bbots\b|crawler|crawling|spider|scraper|scrapy|\+https?:\/\/)/i;

const HUMAN_RE = /\b(Mozilla|AppleWebKit|Chrome|Firefox|Safari|Edge|OPR|Brave|Vivaldi)\b/i;

export function classifyUserAgent(ua: string | null | undefined): AgentClass {
  // No header at all, or an empty one. Not a browser, and not ambiguous.
  if (!ua) return 'script';
  const trimmed = ua.trim();
  if (!trimmed) return 'script';

  // Order matters, and getting it wrong is how 94% of the human count became
  // automation. Everything automated that also carries a browser family string
  // has to be tested before HUMAN_RE, which matches on that family string alone.
  if (AI_BOT_RE.test(trimmed)) return 'ai_bot';
  if (AI_RUNTIME_RE.test(trimmed)) return 'ai_runtime';
  if (SEARCH_BOT_RE.test(trimmed)) return 'search_bot';
  if (HEADLESS_RE.test(trimmed)) return 'headless';
  if (GENERIC_BOT_RE.test(trimmed)) return 'search_bot';
  if (SCRIPT_RE.test(trimmed)) return 'script';
  if (HUMAN_RE.test(trimmed)) return 'human';
  return 'unknown';
}

/**
 * True if the caller is a known automated agent - useful for skipping
 * client-side analytics scripts or for routing logic that shouldn't
 * count bots as 'sessions'.
 */
export function isBotLike(ua: string | null | undefined): boolean {
  const c = classifyUserAgent(ua);
  return c === 'ai_bot' || c === 'ai_runtime' || c === 'search_bot' || c === 'headless' || c === 'script';
}
