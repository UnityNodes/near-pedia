export interface VideoChannel {
  id: string;
  name: string;
}

export const VIDEO_CHANNELS: readonly VideoChannel[] = [
  { id: 'UCuKdIYVN8iE3fv8alyk1aMw', name: 'NEAR Protocol' },
  { id: 'UCq0iWZQuXhvP8yQzDZsmWfQ', name: 'NEAR DevHub' },
];

export const VIDEO_CHANNEL_NAMES: readonly string[] = VIDEO_CHANNELS.map(c => c.name);

export function channelNamesText(): string {
  if (VIDEO_CHANNEL_NAMES.length < 2) return VIDEO_CHANNEL_NAMES.join('');
  return `${VIDEO_CHANNEL_NAMES.slice(0, -1).join(', ')} and ${VIDEO_CHANNEL_NAMES[VIDEO_CHANNEL_NAMES.length - 1]}`;
}

export function exactChannel(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return VIDEO_CHANNEL_NAMES.find(n => n.toLowerCase() === wanted) ?? null;
}
