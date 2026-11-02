import { pathToFileURL } from 'node:url';

/**
 * True only when this module is the file node was told to run.
 *
 * WHY IT IS SHARED. scripts/push-radar-tg.ts and the other alert scripts
 * all called guardSync(...) at top level, so merely IMPORTING
 * one of them posted to Discord, Telegram or Slack. A test that wanted to
 * exercise a pure helper out of any of those files could not do it without
 * sending a real message. responder-post.ts had already solved this, inline, and
 * was the only one of the four that had.
 *
 * `pathToFileURL` rather than string-concatenating `file://`: argv[1] is a
 * filesystem path, and a path containing a space or a non-ASCII character
 * produces a URL that never compares equal, which would silently turn the guard
 * into "never an entrypoint" and stop the script running at all.
 *
 * Pass import.meta.url from the CALLING module; a helper cannot read its
 * caller's identity.
 *
 *   if (isEntrypoint(import.meta.url)) { guardSync('name', main).catch(...) }
 */
export function isEntrypoint(moduleUrl: string): boolean {
  const argv1 = process.argv[1];
  if (typeof argv1 !== 'string' || argv1.length === 0) return false;
  return moduleUrl === pathToFileURL(argv1).href;
}
