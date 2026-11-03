import { describe, expect, it } from 'vitest';
import { DEFAULT_NEARAI_MODEL, UnverifiedAnswerError, nearAiConfig, receiptOf, verifiedChat } from '@/lib/near-ai';
import type { VerifiedCompletionResult } from '@nearai/inference-sdk';

describe('nearAiConfig', () => {
  it('needs a key and defaults the model', () => {
    expect(nearAiConfig({})).toBeNull();
    expect(nearAiConfig({ NEARAI_API_KEY: ' k ' })).toEqual({ apiKey: 'k', model: DEFAULT_NEARAI_MODEL });
    expect(nearAiConfig({ NEARAI_API_KEY: 'k', NEARAI_MODEL: 'Qwen/Qwen3.8-27B' })?.model).toBe('Qwen/Qwen3.8-27B');
  });
});

describe('receiptOf', () => {
  const v = {
    id: 'chatcmpl-1',
    completionId: 'chatcmpl-1',
    signatureKind: 'provider_tee',
    signature: { kind: 'provider_tee', signer: { signingAlgo: 'ecdsa', signingAddress: '0xabc' }, signedText: 'z-ai/glm-5.3-flash:aa:bb', signature: '0xsig' },
    attestation: { tcbStatus: 'UpToDate' },
  } as unknown as VerifiedCompletionResult;

  it('links NEAR AI\'s Verification Center with the receipt in the fragment, as its docs define it', () => {
    const r = receiptOf('z-ai/glm-5.3-flash', v, true, new Date('2026-11-01T19:00:00Z'));
    expect(r).toMatchObject({ signature_kind: 'provider_tee', signing_address: '0xabc', tcb_status: 'UpToDate', e2ee: true });
    const [base, frag] = r.verify_url.split('#receipt=');
    expect(base).toBe('https://cloud.near.ai/verify?model=z-ai%2Fglm-5.3-flash');
    expect(JSON.parse(Buffer.from(frag, 'base64url').toString())).toEqual({
      completionId: 'chatcmpl-1', model: 'z-ai/glm-5.3-flash', signatureKind: 'provider_tee', signingAlgo: 'ecdsa',
      signingAddress: '0xabc', signedText: 'z-ai/glm-5.3-flash:aa:bb', signature: '0xsig', verifiedAt: '2026-11-01T19:00:00.000Z',
    });
  });
});

describe('verifiedChat', () => {
  const cfg = { apiKey: 'k', model: 'z-ai/glm-5.3-flash' };
  const msgs = [{ role: 'user' as const, content: 'q' }];
  const sig = (kind: string) => ({ id: 'c1', completionId: 'c1', signatureKind: kind, signature: { kind, signer: { signingAlgo: 'ecdsa', signingAddress: '0xabc' }, signedText: 't', signature: 's' }, attestation: { tcbStatus: 'UpToDate' } });
  const client = (opts: { text?: string; kind?: string; verifyThrows?: boolean; finish?: string }) => ({
    chat: { completions: { create: async () => ({ id: 'c1', choices: [{ message: { content: opts.text ?? 'answer' }, finish_reason: opts.finish ?? 'stop' }] }) } },
    verifyResponse: async () => {
      if (opts.verifyThrows) throw new Error('signature mismatch');
      return sig(opts.kind ?? 'provider_tee') as never;
    },
  });

  it('returns a model-signed answer with its receipt', async () => {
    const r = await verifiedChat(cfg, msgs, { maxTokens: 10 }, client({}));
    expect(r).toMatchObject({ text: 'answer', truncated: false, receipt: { signature_kind: 'provider_tee', completion_id: 'c1' } });
  });

  it('withholds an answer whose signature does not verify, is only the gateway\'s, or is empty', async () => {
    await expect(verifiedChat(cfg, msgs, { maxTokens: 10 }, client({ verifyThrows: true }))).rejects.toBeInstanceOf(UnverifiedAnswerError);
    await expect(verifiedChat(cfg, msgs, { maxTokens: 10 }, client({ kind: 'gateway' }))).rejects.toThrow(/gateway signature/);
    await expect(verifiedChat(cfg, msgs, { maxTokens: 10 }, client({ text: '  ' }))).rejects.toThrow(/empty/);
  });

  it('tries once more after a dropped connection or a gateway 5xx, but not after a 4xx', async () => {
    const flaky = (first: Error) => {
      let calls = 0;
      const c = client({});
      const create = c.chat.completions.create;
      c.chat.completions.create = async () => {
        calls++;
        if (calls === 1) throw first;
        return create();
      };
      return { c, calls: () => calls };
    };
    const dropped = flaky(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }));
    expect((await verifiedChat(cfg, msgs, { maxTokens: 10 }, dropped.c)).text).toBe('answer');
    expect(dropped.calls()).toBe(2);
    const gateway = flaky(Object.assign(new Error('bad gateway'), { status: 502 }));
    expect((await verifiedChat(cfg, msgs, { maxTokens: 10 }, gateway.c)).text).toBe('answer');
    const refused = flaky(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(verifiedChat(cfg, msgs, { maxTokens: 10 }, refused.c)).rejects.toThrow(/bad request/);
    expect(refused.calls()).toBe(1);
  });

  it('waits for a signature NEAR AI has not published yet, and gives up on any other verify error', async () => {
    let calls = 0;
    const late = { ...client({}), verifyResponse: async () => {
      calls++;
      if (calls === 1) throw new Error('[api.http_status] Cloud API completion signature returned HTTP 404');
      return sig('provider_tee') as never;
    } };
    expect((await verifiedChat(cfg, msgs, { maxTokens: 10 }, late)).receipt.signature_kind).toBe('provider_tee');
    expect(calls).toBe(2);
  }, 10_000);

  it('signs the receipt with the model the call asked for', async () => {
    const r = await verifiedChat(cfg, msgs, { maxTokens: 10, model: 'Qwen/Qwen3.8-27B' }, client({}));
    expect(r.receipt.model).toBe('Qwen/Qwen3.8-27B');
  });

  it('says when the answer hit its length limit', async () => {
    expect((await verifiedChat(cfg, msgs, { maxTokens: 10 }, client({ finish: 'length' }))).truncated).toBe(true);
  });
});
