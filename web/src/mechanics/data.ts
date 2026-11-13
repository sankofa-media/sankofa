// The mechanics' data files, fetched once, on first use.
import type { ChecksFile } from './checks/model';
import type { DocsFile } from './docs/model';
import type { ObjectsFile } from './objects/model';
import type { ProseFile } from './guide/model';

const cache = new Map<string, Promise<unknown>>();

function load<T>(name: string): Promise<T | null> {
  if (!cache.has(name))
    cache.set(
      name,
      fetch(`data/${name}.json`)
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
        .catch(() => null),
    );
  return cache.get(name) as Promise<T | null>;
}

export const documents = () => load<DocsFile>('documents');
export const objects = () => load<ObjectsFile>('objects');
export const checks = () => load<ChecksFile>('checks');
export const guide = () => load<ProseFile>('guide');
/** null when the content has no dedication. */
export const dedication = () => load<ProseFile>('dedication');
