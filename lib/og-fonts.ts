import { readFile } from 'fs/promises';
import path from 'path';

const FONT_DIR = path.join(process.cwd(), 'lib', 'og-fonts');

export const OG_FONT_FAMILY = 'Space Grotesk';

export async function ogFonts() {
  const [regular, bold] = await Promise.all(
    [400, 700].map((weight) => readFile(path.join(FONT_DIR, `SpaceGrotesk-${weight}.ttf`))),
  );
  return [
    { name: OG_FONT_FAMILY, data: regular, weight: 400 as const, style: 'normal' as const },
    { name: OG_FONT_FAMILY, data: bold, weight: 700 as const, style: 'normal' as const },
  ];
}
