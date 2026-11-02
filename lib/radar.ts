/**
 * Shared rules for reading a radar item.
 *
 * This file exists because of the pattern that ran through the whole audit:
 * a rule gets written into one surface and its siblings never learn it.
 * `/radar` renders the deadline chip, `/api/feed/radar` puts it in a
 * summary line, and get_radar returns it over MCP. Three places, one rule.
 */

/**
 * Has this deadline already gone?
 *
 * `radar_items.deadline` was filled on 0 of 137 rows until the extractor was
 * widened on 2026-08-02, so the chip had never rendered and nothing had to
 * decide what a past date should look like. Now 13 items carry one and several
 * have closed: an item outlives its own deadline because expiry runs 30 or 90
 * days from publication, so a closed vote stays on the page for weeks
 * afterwards. Printing it in alarm red tells a validator to act on something
 * that finished in May.
 *
 * Deadlines are not all ISO. The corpus writes "June 24, 2026" as often as
 * "2026-07-09", and two items use a bare `MM/DD` the extractor deliberately
 * refuses. Anything unparseable is treated as UPCOMING: a live deadline shown
 * as closed is the more expensive mistake of the two.
 */
export function deadlinePassed(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  // A four-digit year has to be present. Date.parse('07/07') does NOT fail: V8
  // reads it as 7 July 2001 and the date comes back two decades in the past, so
  // a bare MM/DD would render CLOSED with total confidence. refresh-radar
  // refuses that form today, but this helper is the thing four surfaces trust,
  // and it should not depend on its only current caller staying careful.
  if (!/\b\d{4}\b/.test(deadline)) return false;
  const t = Date.parse(deadline);
  return Number.isFinite(t) && t < Date.now();
}
