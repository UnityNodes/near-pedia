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
  return VIDEO_CHANNEL_NAMES.join(', ');
}

export function exactChannel(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return VIDEO_CHANNEL_NAMES.find(n => n.toLowerCase() === wanted) ?? null;
}
