'use client';
import { useState, useEffect } from 'react';

interface Props { url: string; filename: string; }

export function PdfViewer({ url, filename }: Props) {
  const [open, setOpen] = useState(false);
  const proxyUrl = `/api/cip-pdf?url=${encodeURIComponent(url)}`;

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button className="pdf-open-btn" onClick={() => setOpen(true)}>
        ↗ Read PDF, {filename}
      </button>

      {open && (
        <div className="pdf-modal-overlay" onClick={() => setOpen(false)}>
          <div className="pdf-modal" onClick={e => e.stopPropagation()}>
            <div className="pdf-modal-bar">
              <span className="pdf-modal-title">{filename}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a href={proxyUrl} download={filename} className="pdf-modal-dl">↓ Download</a>
                <button className="pdf-modal-close" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
            <iframe
              src={proxyUrl}
              className="pdf-modal-frame"
              title={filename}
            />
          </div>
        </div>
      )}
    </>
  );
}
