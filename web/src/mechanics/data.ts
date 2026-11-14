// The mechanics' data files, fetched once, on first use. A file that is not
// there is null; one that could not be loaded rejects and is asked for again
// next time, so a slow line never leaves a view empty for good.
import type { ChecksFile } from './checks/model';
import type { DocsFile } from './docs/model';
import type { ObjectsFile } from './objects/model';
import type { ProseFile } from './guide/model';
import { loadJson } from '../lib/loadJson';

const cache = new Map<string, Promise<unknown>>();

function load<T>(name: string): Promise<T | null> {
  let p = cache.get(name) as Promise<T | null> | undefined;
  if (!p) {
    p = loadJson<T>(`data/${name}.json`, { timeout: 12_000, tries: 2 });
    cache.set(name, p);
    p.catch(() => cache.delete(name));
  }
  return p;
}

/** For tests: forget what was loaded. */
export function resetData(): void {
  cache.clear();
}

export const documents = () => load<DocsFile>('documents');
export const objects = () => load<ObjectsFile>('objects');
export const checks = () => load<ChecksFile>('checks');
export const guide = () => load<ProseFile>('guide');
/** null when the content has no dedication. */
export const dedication = () => load<ProseFile>('dedication');
