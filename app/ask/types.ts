export interface Source { n: number; kind: string; title: string; url: string | null; as_of: string | null }
export interface Receipt { model: string; signature_kind: string; signing_address: string; tcb_status: string; e2ee: boolean; verified_at: string; verify_url: string }
export interface Anchor { date: string; hash: string; network: string | null; explorer_url: string | null }
export interface Answer { answer: string; truncated: boolean; sources: Source[]; receipt: Receipt; db_anchor: Anchor | null }

export interface Turn {
  id: string;
  question: string;
  code?: { text: string; filename?: string };
  askedAt: string;
  status: 'pending' | 'done' | 'error';
  result?: Answer;
  error?: string;
}

export const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//.test(u);
