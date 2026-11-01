'use client';

import { useState } from 'react';

export function CipTldr({ cipId, initial }: { cipId: string; initial: string | null }) {
  const [tldr, setTldr] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/cips/${cipId}/tldr`);
      const data = await res.json() as { tldr?: string; error?: string };
      if (data.tldr) setTldr(data.tldr);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rd-tldr" aria-label="TL;DR">
      <div className="rd-tldr-head">
        <span className="rd-tldr-k">TL;DR</span>
        {!tldr && !loading && (
          <button type="button" onClick={generate} className="pg-btn pg-btn--line rd-btn-sm">
            Generate
          </button>
        )}
        {loading && <span className="rd-tldr-state" role="status">generating…</span>}
        {error && <span className="rd-tldr-state rd-tldr-state--bad" role="alert">failed, try again</span>}
      </div>
      {tldr && <p>{tldr}</p>}
    </section>
  );
}
