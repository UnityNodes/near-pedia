import { describe, it, expect } from 'vitest';
import { classifyUserAgent, isBotLike } from '@/lib/user-agent-classify';

describe('classifyUserAgent', () => {
  it.each([
    ['Mozilla/5.0 GPTBot/1.0 (+https://openai.com/gptbot)', 'ai_bot'],
    ['ChatGPT-User/2.0', 'ai_bot'],
    ['ClaudeBot/1.0 (+claudebot@anthropic.com)', 'ai_bot'],
    ['PerplexityBot/1.0', 'ai_bot'],
    ['Mozilla/5.0 (compatible; Google-Extended)', 'ai_bot'],
    ['Mozilla/5.0 cohere-ai', 'ai_bot'],
    ['Applebot-Extended/1.0', 'ai_bot'],
    ['Bytespider; spider-feedback@bytedance.com', 'ai_bot'],
  ])('%s → ai_bot', (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });

  it('classifies Claude.ai runtime fetches as ai_runtime', () => {
    expect(classifyUserAgent('Claude/2.1 (+https://claude.ai)')).toBe('ai_runtime');
  });

  it('classifies MCP clients as ai_runtime', () => {
    expect(classifyUserAgent('@modelcontextprotocol/client-1.0')).toBe('ai_runtime');
  });

  it.each([
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search_bot'],
    ['Bingbot/2.0', 'search_bot'],
    ['Mozilla/5.0 (X11; DuckDuckBot)', 'search_bot'],
    ['Twitterbot/1.0', 'search_bot'],
    ['Discordbot/2.0', 'search_bot'],
    ['Mozilla/5.0 (WhatsApp/2.0)', 'search_bot'],
  ])('%s → search_bot', (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });

  it.each([
    ['curl/7.88.1', 'script'],
    ['Wget/1.21', 'script'],
    ['python-requests/2.28', 'script'],
    ['Go-http-client/1.1', 'script'],
    ['PostmanRuntime/7.32', 'script'],
    ['node', 'script'],
    ['node-fetch/2.6', 'script'],
  ])('%s → script', (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });

  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 'human'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0', 'human'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Firefox/124.0', 'human'],
  ])('%s → human', (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });

  // A missing header is not an unrecognised one. No browser omits User-Agent,
  // so an absent value is a non-browser client and must not reach the human
  // counters, which include 'unknown'.
  it('returns script for a missing or empty user-agent', () => {
    expect(classifyUserAgent('')).toBe('script');
    expect(classifyUserAgent(null)).toBe('script');
    expect(classifyUserAgent(undefined)).toBe('script');
    expect(classifyUserAgent('   ')).toBe('script');
  });

  it('returns unknown for opaque agents', () => {
    expect(classifyUserAgent('SomeRandomString/1.0')).toBe('unknown');
  });

  it('ai_bot wins over the generic Mozilla token', () => {
    expect(classifyUserAgent('Mozilla/5.0 compatible; GPTBot/1.0; +https://openai.com')).toBe('ai_bot');
  });

  it('script wins over Mozilla when curl is present', () => {
    expect(classifyUserAgent('Mozilla curl/7.88.1')).toBe('script');
  });
});

describe('isBotLike', () => {
  it('returns true for all four bot-like classes', () => {
    expect(isBotLike('GPTBot/1.0')).toBe(true);
    expect(isBotLike('Claude/2.0')).toBe(true);
    expect(isBotLike('Googlebot/2.1')).toBe(true);
    expect(isBotLike('curl/7.88')).toBe(true);
  });
  it('returns false only for a real browser or an unplaceable agent', () => {
    expect(isBotLike('Mozilla/5.0 Chrome/124')).toBe(false);
    expect(isBotLike('SomeAgent/9 nobody has heard of')).toBe(false);
    // An absent User-Agent is bot-like: no browser omits the header. This
    // asserted false while a missing header classified as 'unknown'.
    expect(isBotLike('')).toBe(true);
    expect(isBotLike(null)).toBe(true);
  });
});
