/**
 * Answers through NEAR AI Cloud: a model served in a TEE, the request
 * encrypted end to end to the model's key from verified attestation, and
 * the response's signature checked before the answer is shown.
 *
 * @nearai/inference-sdk does the attestation (Intel TDX quote of the Gateway
 * and of the model's CVM), the E2EE and the signature check. It declares
 * Node 24; this server runs Node 22 for better-sqlite3's ABI, so the
 * standard-Fetch entry point is used, not `/node`. The difference, as the
 * SDK documents it: Fetch cannot read the TLS peer certificate, so the
 * Gateway attestation is not bound to the TLS connection. The quote, the
 * model key and the response signature are still verified.
 *
 * What a user pastes passes through this server's memory (it is never
 * stored or logged) and leaves it encrypted to the model's TEE key.
 *
 * Not checked, as NEAR AI's own Verification Center does not check it
 * either: that the attested deployment is an approved build of the named
 * model (no measurement allowlist), and the SDK's default TCB policy, which
 * accepts OutOfDate as well as UpToDate. The receipt reports the TCB status
 * it got.
 *
 * An answer that does not verify is not returned: the endpoint's promise is
 * a verified answer, and an unverified one presented next to it is the
 * thing it exists to prevent.
 */

import { InferenceClient, type VerifiedCompletionResult } from '@nearai/inference-sdk';

export const NEARAI_BASE_URL = 'https://cloud-api.near.ai/v1';
/** Served by NEAR AI itself with model attestation, the model the SDK's E2EE example uses. */
export const DEFAULT_NEARAI_MODEL = 'z-ai/glm-5.3-flash';
export const VERIFY_PAGE = 'https://cloud.near.ai/verify';

export interface NearAiConfig { apiKey: string; model: string }

export function nearAiConfig(env: Readonly<Record<string, string | undefined>> = process.env): NearAiConfig | null {
  const apiKey = env.NEARAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.NEARAI_MODEL?.trim() || DEFAULT_NEARAI_MODEL };
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface AnswerReceipt {
  model: string;
  completion_id: string;
  /** provider_tee: signed by the model's TEE; gateway: signed by the verified Gateway only. */
  signature_kind: 'provider_tee' | 'gateway';
  signing_algo: string;
  signing_address: string;
  signed_text: string;
  signature: string;
  tcb_status: string;
  e2ee: boolean;
  verified_at: string;
  /** Opens NEAR AI's Verification Center on this reply; the receipt rides in the fragment, which browsers do not send. */
  verify_url: string;
}

export function receiptOf(model: string, v: VerifiedCompletionResult, e2ee: boolean, verifiedAt: Date): AnswerReceipt {
  const r = {
    model,
    completion_id: v.id,
    signature_kind: v.signatureKind,
    signing_algo: v.signature.signer.signingAlgo,
    signing_address: v.signature.signer.signingAddress,
    signed_text: v.signature.signedText,
    signature: v.signature.signature,
    tcb_status: v.attestation.tcbStatus,
    e2ee,
    verified_at: verifiedAt.toISOString(),
  };
  const fragment = Buffer.from(JSON.stringify({
    completionId: r.completion_id,
    model,
    signatureKind: r.signature_kind,
    signingAlgo: r.signing_algo,
    signingAddress: r.signing_address,
    signedText: r.signed_text,
    signature: r.signature,
    verifiedAt: r.verified_at,
  })).toString('base64url');
  return { ...r, verify_url: `${VERIFY_PAGE}?model=${encodeURIComponent(model)}#receipt=${fragment}` };
}

/** A request that has not answered in this long is abandoned: attestation (~3 s) plus a long answer fits well inside it. */
export const CHAT_TIMEOUT_MS = 90_000;
/** Kept just long enough for verifyResponse() to run right after the answer, instead of the SDK's 60 minutes. */
const RESPONSE_CACHE_MS = 5 * 60_000;
export const MAX_CONCURRENT = 4;
/** One more try after a dropped connection or a 5xx from the gateway, within the same CHAT_TIMEOUT_MS. */
const RETRY_DELAY_MS = 800;

function isTransient(e: unknown): boolean {
  const { name, status } = e as { name?: string; status?: unknown };
  if (name === 'AbortError' || name === 'TimeoutError') return false;
  return typeof status === 'number' ? status >= 500 : true;
}

let cached: { key: string; client: InferenceClient } | null = null;

/** One client per key and model: it caches the verified attestation, which costs about 3 s to fetch and check. */
function clientFor(cfg: NearAiConfig): InferenceClient {
  const key = `${cfg.apiKey}\u0000${cfg.model}`;
  if (cached?.key !== key) {
    cached = { key, client: new InferenceClient({ baseUrl: NEARAI_BASE_URL, apiKey: cfg.apiKey, e2ee: true, responseCacheTimeToLiveMs: RESPONSE_CACHE_MS }) };
  }
  return cached.client;
}

export class UnverifiedAnswerError extends Error {}
export class BusyError extends Error {}

/** The part of InferenceClient this uses, so a test can stand in for it. */
export interface ChatClient {
  chat: { completions: { create(body: { model: string; messages: ChatMessage[]; max_tokens: number }, opts?: { signal?: AbortSignal }): Promise<{ id: string; choices: Array<{ message?: { content?: string | null } | null; finish_reason?: string | null }> }> } };
  verifyResponse(id: string): Promise<VerifiedCompletionResult>;
}

let inFlight = 0;

/**
 * Only a model signature counts: a `gateway` signature proves the gateway
 * relayed these bytes, not that the attested model produced them, and the
 * receipt would claim more than it shows.
 */
export async function verifiedChat(
  cfg: NearAiConfig,
  messages: readonly ChatMessage[],
  opts: { maxTokens: number },
  client: ChatClient = clientFor(cfg) as unknown as ChatClient,
): Promise<{ text: string; truncated: boolean; receipt: AnswerReceipt }> {
  if (inFlight >= MAX_CONCURRENT) throw new BusyError(`${MAX_CONCURRENT} answers are already being written; try again in a minute`);
  inFlight++;
  try {
    const signal = AbortSignal.timeout(CHAT_TIMEOUT_MS);
    const create = () => client.chat.completions.create({ model: cfg.model, messages: [...messages], max_tokens: opts.maxTokens }, { signal });
    const completion = await create().catch(async (e: unknown) => {
      if (!isTransient(e) || signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return create();
    });
    const choice = completion.choices[0];
    const text = choice?.message?.content?.trim() ?? '';
    let verified: VerifiedCompletionResult;
    try {
      verified = await client.verifyResponse(completion.id);
    } catch (e) {
      throw new UnverifiedAnswerError(`NEAR AI answered but the response did not verify: ${(e as Error).message}`);
    }
    if (verified.signatureKind !== 'provider_tee') throw new UnverifiedAnswerError(`the response carries a ${verified.signatureKind} signature, not one from the model's TEE`);
    if (!text) throw new UnverifiedAnswerError('NEAR AI returned an empty answer');
    return { text, truncated: choice?.finish_reason === 'length', receipt: receiptOf(cfg.model, verified, true, new Date()) };
  } finally {
    inFlight--;
  }
}
