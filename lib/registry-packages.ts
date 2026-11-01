/**
 * npm and crates.io package documents reduced to one shape, and the
 * difference between two snapshots of a package as change events.
 *
 * npm almost never carries a deprecation flag for NEAR packages: on
 * 2026-11-01 none of near-api-js, near-sdk-js, near-cli, @near-js/* or
 * wallet-selector had a single deprecated version, although near-sdk-js and
 * near-cli are archived with "DEPRECATED" READMEs. So the registry fields
 * that matter are the latest version, its date and the repository link that
 * joins a package to its GitHub state; the flag is stored when present.
 */

import type { ChangeEvent } from './change-events';

export type Registry = 'npm' | 'crates';

export interface VersionSnapshot {
  version: string;
  published_at: string | null;
  deprecated: string | null;
  yanked: boolean;
  yank_message: string | null;
}

export interface PackageSnapshot {
  id: string;
  registry: Registry;
  name: string;
  description: string | null;
  latest_version: string | null;
  latest_published_at: string | null;
  latest_stable_version: string | null;
  deprecated: string | null;
  repository_url: string | null;
  homepage: string | null;
  registry_url: string;
  modified_at: string | null;
  versions: VersionSnapshot[];
}

export function packageId(registry: Registry, name: string): string {
  return `${registry}:${name}`;
}

/**
 * A repository field as https://github.com/<owner>/<repo>, or the trimmed
 * original when it is not GitHub. npm writes it a dozen ways:
 * `git+https://…/x.git`, `git+ssh://git@github.com/…`, `github:owner/repo`,
 * a bare `owner/repo`, or an object with a `url`.
 */
export function normalizeRepoUrl(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw : (raw as { url?: unknown } | null)?.url;
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const full = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (full) return `https://github.com/${full[1]}/${full[2]}`;
  const short = s.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short) return `https://github.com/${short[1]}/${short[2]}`;
  return s;
}

interface NpmDoc {
  name?: string;
  description?: unknown;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { deprecated?: unknown; repository?: unknown }>;
  time?: Record<string, string>;
  repository?: unknown;
  homepage?: unknown;
}

const isPrerelease = (v: string) => v.includes('-');

/** Registry documents are user-written JSON: a description can be an object or a number. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function fromNpm(doc: NpmDoc): PackageSnapshot {
  if (!doc.name) throw new Error('npm document without a name');
  const versions = doc.versions ?? {};
  const time = doc.time ?? {};
  const latest = doc['dist-tags']?.latest ?? null;
  const latestDoc = latest ? versions[latest] : undefined;
  const asMessage = (d: unknown) => (typeof d === 'string' && d.trim() ? d.trim() : null);
  const all: VersionSnapshot[] = Object.entries(versions).map(([version, v]) => ({
    version,
    published_at: time[version] ?? null,
    deprecated: asMessage(v.deprecated),
    yanked: false,
    yank_message: null,
  }));
  const stable = all
    .filter((v) => !isPrerelease(v.version) && v.published_at)
    .sort((a, b) => (a.published_at! < b.published_at! ? 1 : -1))[0]?.version ?? null;
  return {
    id: packageId('npm', doc.name),
    registry: 'npm',
    name: doc.name,
    description: text(doc.description),
    latest_version: latest,
    latest_published_at: latest ? time[latest] ?? null : null,
    latest_stable_version: latest && !isPrerelease(latest) ? latest : stable,
    deprecated: asMessage(latestDoc?.deprecated),
    repository_url: normalizeRepoUrl(doc.repository) ?? normalizeRepoUrl(latestDoc?.repository),
    homepage: text(doc.homepage),
    registry_url: `https://www.npmjs.com/package/${doc.name}`,
    modified_at: time.modified ?? null,
    versions: all,
  };
}

interface CratesDoc {
  crate?: {
    name?: string;
    description?: unknown;
    max_version?: string | null;
    max_stable_version?: string | null;
    newest_version?: string | null;
    updated_at?: string | null;
    repository?: string | null;
    homepage?: unknown;
  };
  versions?: Array<{ num: string; created_at?: string | null; yanked?: boolean; yank_message?: string | null }>;
}

export function fromCrates(doc: CratesDoc): PackageSnapshot {
  const c = doc.crate;
  if (!c?.name) throw new Error('crates.io document without a crate name');
  const versions: VersionSnapshot[] = (doc.versions ?? []).map((v) => ({
    version: v.num,
    published_at: v.created_at ?? null,
    deprecated: null,
    yanked: Boolean(v.yanked),
    yank_message: v.yank_message?.trim() || null,
  }));
  const latest = c.max_version ?? c.newest_version ?? null;
  const allYanked = versions.length > 0 && versions.every((v) => v.yanked);
  return {
    id: packageId('crates', c.name),
    registry: 'crates',
    name: c.name,
    description: text(c.description),
    latest_version: latest,
    latest_published_at: versions.find((v) => v.version === latest)?.published_at ?? null,
    latest_stable_version: c.max_stable_version ?? null,
    deprecated: allYanked ? 'every published version is yanked' : null,
    repository_url: normalizeRepoUrl(c.repository),
    homepage: text(c.homepage),
    registry_url: `https://crates.io/crates/${c.name}`,
    modified_at: c.updated_at ?? null,
    versions,
  };
}

/**
 * Change events between the stored snapshot and a fresh one. A package seen
 * for the first time yields none: its whole history arriving is not news,
 * and its current state is in the packages table for anyone who asks.
 */
export function diffPackage(before: PackageSnapshot | null, after: PackageSnapshot): ChangeEvent[] {
  if (!before) return [];
  const events: ChangeEvent[] = [];
  const subject = after.id;
  const url = after.registry_url;

  if (!before.deprecated && after.deprecated) {
    events.push({ kind: 'package_deprecated', subject, title: `${after.name} marked deprecated on ${after.registry}`, detail: { message: after.deprecated, version: after.latest_version }, source_url: url, key: after.deprecated });
  } else if (before.deprecated && !after.deprecated) {
    events.push({ kind: 'package_undeprecated', subject, title: `${after.name} no longer marked deprecated on ${after.registry}`, source_url: url, key: `${after.latest_version}` });
  }

  if (after.latest_version && before.latest_version !== after.latest_version) {
    events.push({ kind: 'package_new_latest', subject, title: `${after.name} ${after.latest_version} is the latest on ${after.registry}`, detail: { from: before.latest_version, to: after.latest_version, published_at: after.latest_published_at }, source_url: url, key: after.latest_version });
  }

  const old = new Map(before.versions.map((v) => [v.version, v]));
  for (const v of after.versions) {
    const prev = old.get(v.version);
    if (v.yanked && !prev?.yanked) {
      events.push({ kind: 'version_yanked', subject, title: `${after.name} ${v.version} yanked on ${after.registry}`, detail: { version: v.version, message: v.yank_message }, source_url: url, key: v.version });
    }
    if (v.deprecated && !prev?.deprecated) {
      events.push({ kind: 'version_deprecated', subject, title: `${after.name} ${v.version} deprecated on ${after.registry}`, detail: { version: v.version, message: v.deprecated }, source_url: url, key: `${v.version}|${v.deprecated}` });
    }
  }
  return events;
}
