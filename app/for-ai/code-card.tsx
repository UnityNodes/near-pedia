import { CopyButton } from './copy-button';

export function CodeCard({ label, code, what }: { label: string; code: string; what: string }) {
  return (
    <div className="fa-code" data-theme="dark">
      <div className="fa-code-bar fa-code-bar--label">
        <span className="fa-code-label">{label}</span>
        <CopyButton text={code} what={what} />
      </div>
      <pre tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}
