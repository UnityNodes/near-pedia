export interface EffectiveText {
  chip: string;
  note: string | null;
}

export function splitEffective(text: string | null): EffectiveText | null {
  if (!text) return null;
  const cut = text.indexOf(';');
  if (cut < 0) return { chip: text.trim(), note: null };
  const rest = text.slice(cut + 1).trim();
  const note = rest ? `${rest[0].toUpperCase()}${rest.slice(1)}${/[.!?]$/.test(rest) ? '' : '.'}` : null;
  return { chip: text.slice(0, cut).trim(), note };
}
