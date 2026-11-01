import { BookOpen, Code2, Compass, GitBranch, Link2, MessageCircle, MessagesSquare, Play, Rocket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LinkKind, ResourceSection } from '@/lib/resources';

const KIND_ICONS: Record<LinkKind, LucideIcon> = {
  Docs: BookOpen,
  Code: GitBranch,
  Video: Play,
  Forum: MessagesSquare,
  Chat: MessageCircle,
  'This site': Compass,
  Link: Link2,
};

const SECTION_ICONS: Record<ResourceSection, LucideIcon> = {
  start: Rocket,
  build: Code2,
  community: MessagesSquare,
  learn: BookOpen,
};

export function KindIcon({ kind, size = 16 }: { kind: LinkKind; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

export function SectionIcon({ id, size = 18 }: { id: ResourceSection; size?: number }) {
  const Icon = SECTION_ICONS[id];
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
