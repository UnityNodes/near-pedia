import { isoNowSql } from './formats';

/**
 * A radar_items row stays live until its expires_at passes; NULL means no end
 * date and stays live on purpose. This exists because get_radar once served 22
 * CRITICAL alerts of which 11 had already expired: the tool and the /radar
 * page each hand-rolled their own expiry filter and drifted apart. One
 * function, every road uses it.
 */
export function radarLiveSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}expires_at IS NULL OR ${p}expires_at > ${isoNowSql()})`;
}
