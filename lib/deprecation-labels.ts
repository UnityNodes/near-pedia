import type { Status } from './deprecation-types';
import type { Tone } from './status';

export const STATUS_LABEL: Record<Status, string> = {
  removed: 'Removed',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
  changed: 'Changed',
  possibly_deprecated: 'Possibly deprecated',
};

export const STATUS_TONE: Record<Status, Tone> = {
  removed: 'bad',
  deprecated: 'bad',
  superseded: 'info',
  changed: 'lime',
  possibly_deprecated: 'mute',
};
