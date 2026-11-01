import { FileDown } from 'lucide-react';
import type { CipAttachmentRow } from '@/lib/cips';

export function CipAttachmentsList({ attachments }: { attachments: CipAttachmentRow[] }) {
  if (!attachments.length) return null;

  return (
    <ul className="rd-links">
      {attachments.map(a => (
        <li key={a.id}>
          <a
            href={a.github_url ?? a.raw_url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="rd-link"
          >
            <FileDown size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className="rd-link-t">{a.filename}</span>
            {a.pages && <small>{a.pages}p</small>}
          </a>
        </li>
      ))}
    </ul>
  );
}
