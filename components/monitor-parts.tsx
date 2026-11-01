import './monitor-parts.css';
import { deadlinePassed } from '@/lib/radar';
import type { Tone } from '@/lib/status';

export type RadarLevel = 'critical' | 'important' | 'ecosystem';

export const LEVEL_LABEL: Record<RadarLevel, string> = {
  critical: 'Critical',
  important: 'Important',
  ecosystem: 'Ecosystem',
};

export const LEVEL_TONE: Record<RadarLevel, Tone> = {
  critical: 'bad',
  important: 'lime',
  ecosystem: 'info',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const MAX_STAGGER_STEPS = 12;
const STAGGER_MS = 40;

export function deadlineLabel(deadline: string): string {
  return ISO_DATE.test(deadline) ? deadline.slice(0, 16).replace('T', ' ') : deadline;
}

export function SectionHead({ id, label, count, tone }: { id: string; label: string; count?: number; tone?: Tone }) {
  return (
    <h2 className="mn-head" id={id}>
      {tone && <span className="mn-head-dot" data-tone={tone} aria-hidden="true" />}
      {label}
      {count !== undefined && <span className="mn-head-n">{count.toLocaleString('en-US')}</span>}
    </h2>
  );
}

interface RadarRowProps {
  level: RadarLevel;
  title: string;
  body?: string | null;
  href: string | null;
  tags?: string[];
  deadline: string | null;
  published: string;
  index?: number;
}

export function RadarRow({ level, title, body, href, tags = [], deadline, published, index = 0 }: RadarRowProps) {
  const passed = deadline ? deadlinePassed(deadline) : false;
  const className = `pg-row mn-row mn-row--${level}${href ? '' : ' mn-row--static'}`;
  const style = { animationDelay: `${Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS}ms` };
  const day = published.slice(0, 10);

  const content = (
    <>
      <div className="pg-row-main">
        <div className="pg-row-top">
          <span className="pg-tag" data-tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</span>
          {tags.map((tag) => <span key={tag} className="pg-tag">{tag}</span>)}
          {deadline && (
            <span className="pg-tag" data-tone={passed ? 'mute' : 'lime'}>
              {passed ? 'Closed' : 'Due'} {deadlineLabel(deadline)}
            </span>
          )}
        </div>
        <div className="pg-row-title">
          {title}
          {href && <span className="pg-sr"> (opens in a new tab)</span>}
        </div>
        {body && <div className="pg-row-sub mn-clamp">{body}</div>}
      </div>
      <div className="pg-row-end">
        <time className="pg-row-date" dateTime={published}>{day}</time>
        {href && <span className="pg-row-go" aria-hidden="true">↗</span>}
      </div>
    </>
  );

  return href ? (
    <a href={href} className={className} style={style} target="_blank" rel="noopener noreferrer">{content}</a>
  ) : (
    <div className={className} style={style}>{content}</div>
  );
}
