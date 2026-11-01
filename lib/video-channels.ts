export interface VideoChannel {
  id: string;
  name: string;
}

export const VIDEO_CHANNELS: readonly VideoChannel[] = [
  { id: 'UCLlvAEzXBFZ-P3zS6BF2Bjg', name: 'YourChain' },
];

export const VIDEO_CHANNEL_NAMES: readonly string[] = VIDEO_CHANNELS.map(c => c.name);

export function channelNamesText(): string {
  return VIDEO_CHANNEL_NAMES.join(', ');
}

export function exactChannel(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return VIDEO_CHANNEL_NAMES.find(n => n.toLowerCase() === wanted) ?? null;
}
