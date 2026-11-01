import OpenGraphImage from './opengraph-image';
import { SITE, SITE_TITLE } from '@/lib/site.config';

export const runtime = 'nodejs';
export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default OpenGraphImage;
