/**
 * LLM Cascade: a resilient layer over several LLM providers.
 *
 * It tries each provider in a fixed order and streams from the first one that
 * works. If one fails (rate limit, network, missing key) it moves on to the next.
 * The first provider to yield at least one token is committed to: after that
 * there is no switching inside the stream, or the UI would show a jumble of two
 * answers.
 *
 * Provider order (best quality first, all on free tiers):
 *   1. Gemini 2.0 Flash  - 1500 req/day free, 1M TPM
 *   2. Groq llama-3.3-70b - 100k TPD free (~14 req/day)
 *   3. Groq llama-3.1-8b  - 500k TPD free (~100 req/day)
 *   4. OpenAI gpt-4o-mini  - paid last resort (the key is already present for embeddings)
 *
 * A provider with no key in .env is skipped.
 */

import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAICacheManager, type CachedContent } from '@google/generative-ai/server';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CascadeOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type CascadeChunk = { provider: string; text: string };

/**
 * Per-provider deadline.
 *
 * The cascade exists so that one provider being unavailable doesn't take the
 * answer down with it, and "unavailable" was read as throwing. A provider
 * that accepts the connection and then says nothing never throws, so the
 * fallback below it never runs - and every SDK here defaults to a timeout
 * measured in minutes, so nothing capped it.
 *
 * Generous for a stream of a few hundred tokens, short enough that falling
 * through to the next provider still beats waiting.
 */
const PROVIDER_TIMEOUT_MS = 30_000;

// ── Provider: Gemini 2.0 Flash ────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';

let cachedGemini: GoogleGenerativeAI | null = null;
function geminiClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!cachedGemini) cachedGemini = new GoogleGenerativeAI(key);
  return cachedGemini;
}

let cachedCacheManager: GoogleAICacheManager | null = null;
function cacheManager(): GoogleAICacheManager | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!cachedCacheManager) cachedCacheManager = new GoogleAICacheManager(key);
  return cachedCacheManager;
}

// Module-level cache state - survives across requests for the lifetime of the process.
// We store the full CachedContent object (required by getGenerativeModelFromCachedContent)
// and the prompt text it was created for so a prompt change auto-invalidates.
let geminiCachedContent: CachedContent | null = null;
let geminiCachePromptKey: string | null = null;

/**
 * Try to obtain (or reuse) a server-side cached-content for the given system prompt.
 *
 * Gemini Context Caching requirements (as of API v1beta / SDK 0.24.x):
 *  - Model must be a stable version (e.g. "gemini-2.5-flash").
 *  - `contents` is REQUIRED and must be non-empty.  We use a single sentinel
 *    turn so the cache can still anchor a reusable system instruction.
 *  - Minimum cacheable token count is enforced server-side (typically 1 024 tokens
 *    for gemini-2.5-flash).  If the prompt is too small the API returns a 400 and
 *    we fall back transparently.
 *  - TTL default is 1 hour; we use 3 600 s explicitly.
 *
 * Returns the full CachedContent on success, or null on any failure (safe to ignore).
 */
async function getOrCreateGeminiCache(systemPrompt: string): Promise<CachedContent | null> {
  // Simple identity check - reuse if the same prompt text is cached this process run.
  if (geminiCachedContent && geminiCachePromptKey === systemPrompt) {
    return geminiCachedContent;
  }

  const mgr = cacheManager();
  if (!mgr) return null;

  try {
    const cached = await mgr.create({
      model: GEMINI_MODEL,
      // systemInstruction stores the static system prompt in the cache.
      systemInstruction: systemPrompt,
      // `contents` is required; a minimal sentinel turn keeps the cache valid
      // without polluting the conversation history sent at inference time.
      contents: [{ role: 'user', parts: [{ text: '.' }] }],
      ttlSeconds: 3600, // 1 hour - matches free-tier max
    });

    geminiCachedContent = cached;
    geminiCachePromptKey = systemPrompt;
    console.info(`[gemini-cache] created cache: ${cached.name}`);
    return cached;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "too small" (< 1 024 tokens) and permission errors are expected in some
    // environments; log at warn level and continue without caching.
    console.warn(`[gemini-cache] cache creation failed (will proceed without cache): ${msg.slice(0, 200)}`);
    return null;
  }
}

async function* streamGemini(opts: CascadeOptions): AsyncGenerator<string> {
  const client = geminiClient();
  if (!client) throw new Error('GEMINI_API_KEY not set');

  // Gemini convention: system prompt -> systemInstruction; user/assistant -> contents[]
  const sys = opts.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns = opts.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  // Disable "thinking" mode: it wastes tokens on internal reasoning that the user
  // doesn't see. For RAG-grounded answers we don't need step-by-step thinking.
  // Saves ~300-500 thought tokens per request and ~2-3s latency.
  // thinkingConfig field is newer than @google/generative-ai@0.24 types -> cast.
  const generationConfig = {
    maxOutputTokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.3,
    thinkingConfig: { thinkingBudget: 0 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // ── Attempt to use Context Caching for the static system prompt ──────────
  // If the system prompt is large enough (≥ 1 024 tokens for gemini-2.5-flash),
  // the Gemini Caching API stores it server-side and we skip re-sending it on
  // every request - reducing billable input tokens and latency.
  // On failure (prompt too small, API error, etc.) we fall through to the
  // standard non-cached path, which is functionally identical.
  let model;
  if (sys) {
    const cachedContent = await getOrCreateGeminiCache(sys);
    if (cachedContent) {
      try {
        // getGenerativeModelFromCachedContent wires the pre-cached systemInstruction
        // automatically; we must NOT pass systemInstruction again at call time.
        model = client.getGenerativeModelFromCachedContent(
          cachedContent,
          { generationConfig },
          { timeout: PROVIDER_TIMEOUT_MS },
        );
        console.info(`[gemini-cache] using cached content: ${cachedContent.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gemini-cache] getGenerativeModelFromCachedContent failed, falling back: ${msg.slice(0, 150)}`);
        model = null;
      }
    }
  }

  // Fallback: standard model without caching
  if (!model) {
    model = client.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: sys || undefined,
      generationConfig,
    }, { timeout: PROVIDER_TIMEOUT_MS });
  }

  const result = await model.generateContentStream({ contents: turns });
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) yield t;
  }
}

// ── Provider: Groq (works for any Groq-hosted model) ──────────────────────
let cachedGroq: Groq | null = null;
function groqClient(): Groq | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (!cachedGroq) cachedGroq = new Groq({ apiKey: key });
  return cachedGroq;
}

function streamGroqFor(modelName: string) {
  return async function* (opts: CascadeOptions): AsyncGenerator<string> {
    const client = groqClient();
    if (!client) throw new Error('GROQ_API_KEY not set');

    const stream = await client.chat.completions.create({
      model: modelName,
      stream: true,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.3,
      messages: opts.messages,
    }, { timeout: PROVIDER_TIMEOUT_MS });

    for await (const chunk of stream) {
      const t = chunk.choices[0]?.delta?.content ?? '';
      if (t) yield t;
    }
  };
}

// ── Provider: OpenAI (last-resort fallback; key already present for embeddings) ──
let cachedOpenai: OpenAI | null = null;
function openaiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!cachedOpenai) cachedOpenai = new OpenAI({ apiKey: key });
  return cachedOpenai;
}

async function* streamOpenai(opts: CascadeOptions): AsyncGenerator<string> {
  const client = openaiClient();
  if (!client) throw new Error('OPENAI_API_KEY not set');
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    max_tokens: opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.3,
    messages: opts.messages,
  }, { timeout: PROVIDER_TIMEOUT_MS });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content ?? '';
    if (t) yield t;
  }
}

// ── Cascade order ─────────────────────────────────────────────────────────
export type ProviderSpec = {
  name: string;
  isConfigured: () => boolean;
  stream: (opts: CascadeOptions) => AsyncGenerator<string>;
};

const PROVIDERS: ProviderSpec[] = [
  {
    name: 'gemini-2.5-flash',
    isConfigured: () => !!process.env.GEMINI_API_KEY,
    stream: streamGemini,
  },
  {
    name: 'groq-llama-3.3-70b',
    isConfigured: () => !!process.env.GROQ_API_KEY,
    stream: streamGroqFor('llama-3.3-70b-versatile'),
  },
  {
    name: 'groq-llama-3.1-8b',
    isConfigured: () => !!process.env.GROQ_API_KEY,
    stream: streamGroqFor('llama-3.1-8b-instant'),
  },
  {
    name: 'openai-gpt-4o-mini',
    isConfigured: () => !!process.env.OPENAI_API_KEY,
    stream: streamOpenai,
  },
];

/**
 * Стрім із автоматичним fallback на наступний провайдер при помилці.
 *
 * Кожен yield містить { provider, text } - фронт може ігнорувати provider,
 * а API-роут може залогувати який провайдер врятував день.
 *
 * ПІСЛЯ commit point каскад НЕ перемикається: наступний провайдер видав би
 * повну відповідь поверх обірваної, і споживач (app/api/cips/[id]/tldr/route.ts) склеїв
 * би дві - контрольований результат, дослівно, а не помилка. Помилка летить
 * далі, щоб виклик побачив обірваний стрім як помилку, а не як успіх.
 *
 * @throws Error якщо жоден провайдер не стартував, або якщо закомічений
 *         провайдер впав посеред стріму.
 */
export async function* streamWithCascade(
  opts: CascadeOptions,
): AsyncGenerator<CascadeChunk> {
  yield* cascadeOver(PROVIDERS, opts);
}

export async function* cascadeOver(
  providers: ProviderSpec[],
  opts: CascadeOptions,
): AsyncGenerator<CascadeChunk> {
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      errors.push(`${provider.name}: skipped (no API key)`);
      continue;
    }

    const start = Date.now();
    let committed = false;
    try {
      const iter = provider.stream(opts)[Symbol.asyncIterator]();
      // Спробуй отримати перший токен. Якщо тут - помилка, ловимо її ДО того,
      // як юзер побачив хоч щось у UI. Це "commit point".
      const first = await iter.next();
      if (first.done) {
        errors.push(`${provider.name}: empty stream`);
        continue;
      }

      console.info(`[cascade] streaming via ${provider.name} (first chunk in ${Date.now() - start}ms)`);
      committed = true;
      yield { provider: provider.name, text: first.value };

      while (true) {
        const r = await iter.next();
        if (r.done) return;
        yield { provider: provider.name, text: r.value };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (committed) {
        console.error(`[cascade] ${provider.name} failed mid-stream after committing - aborting, NOT falling through: ${msg.slice(0, 150)}`);
        throw new Error(`${provider.name} failed mid-stream after committing: ${msg}`, { cause: err });
      }
      errors.push(`${provider.name}: ${msg.slice(0, 200)}`);
      console.warn(`[cascade] ${provider.name} failed: ${msg.slice(0, 150)} - trying next`);
      // continue to next provider
    }
  }

  // Якщо ми тут - жоден провайдер не зміг відповісти.
  throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
}
