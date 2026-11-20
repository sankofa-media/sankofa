import { describe, expect, it } from 'vitest';
import { extraHashKeys, featurePath, hashOfLocation, langOfLocation, pageOfPath, pathOfPage, routeOfLocation, urlOfRoute } from '../src/lib/pagePath';

describe('page paths', () => {
  it('reads every kind of page, with its language', () => {
    expect(pageOfPath('/')).toEqual({ kind: 'home' });
    expect(pageOfPath('/index.html')).toEqual({ kind: 'home' });
    expect(pageOfPath('/ru/')).toEqual({ kind: 'home', lang: 'ru' });
    expect(pageOfPath('/features/')).toEqual({ kind: 'features', lang: 'en' });
    expect(pageOfPath('/features/angel/')).toEqual({ kind: 'feature', id: 'angel', lang: 'en' });
    expect(pageOfPath('/features/angel')).toEqual({ kind: 'feature', id: 'angel', lang: 'en' });
    expect(pageOfPath('/ru/features/sea-lion-girls/index.html')).toEqual({ kind: 'feature', id: 'sea-lion-girls', lang: 'ru' });
    expect(pageOfPath('/cards/sun-ra/')).toEqual({ kind: 'card', id: 'sun-ra', lang: 'en' });
    expect(pageOfPath('/ru/chapters/v0/')).toEqual({ kind: 'chapter', id: 'v0', lang: 'ru' });
    expect(pageOfPath('/guide/')).toEqual({ kind: 'guide', lang: 'en' });
    expect(pageOfPath('/media/x.jpg')).toBeNull();
    expect(pageOfPath('/cards/')).toBeNull();
    expect(pageOfPath('/features/Bad_Id/')).toBeNull();
  });

  it('writes the same paths back', () => {
    for (const p of ['/', '/ru/', '/features/', '/ru/features/angel/', '/cards/sun-ra/', '/ru/chapters/v3/', '/dedication/']) {
      expect(pathOfPage(pageOfPath(p)!)).toBe(p);
    }
    expect(featurePath('angel', 'ru')).toBe('/ru/features/angel/');
    expect(featurePath(undefined, 'en')).toBe('/features/');
  });

  it('opens a feature from its path, the scene from the hash', () => {
    expect(routeOfLocation('/features/angel/', '')).toMatchObject({ view: 'feature', item: 'angel' });
    expect(routeOfLocation('/features/angel/', '#scene=warm&focus=jazz')).toMatchObject({ view: 'feature', item: 'angel', scene: 'warm', point: { focus: 'jazz' } });
    // The path wins over an old hash naming another feature.
    expect(routeOfLocation('/features/angel/', '#view=feature&item=forever-changes')).toMatchObject({ view: 'feature', item: 'angel' });
    expect(routeOfLocation('/ru/features/', '')).toMatchObject({ view: 'features' });
  });

  it('opens a pre-rendered page at what it shows, unless its hash says otherwise', () => {
    expect(routeOfLocation('/cards/sun-ra/', '')).toEqual({ point: { focus: 'sun-ra' } });
    expect(routeOfLocation('/chapters/v2/', '')).toEqual({ point: {}, ch: 'v2' });
    expect(routeOfLocation('/guide/', '')).toEqual({ point: {}, view: 'guide' });
    expect(routeOfLocation('/cards/sun-ra/', '#view=listen')).toMatchObject({ view: 'listen' });
    expect(routeOfLocation('/', '#view=feature&item=angel')).toMatchObject({ view: 'feature', item: 'angel' });
  });

  it('takes the language from the hash, else from the path', () => {
    expect(langOfLocation('/', '')).toBeUndefined();
    expect(langOfLocation('/ru/features/angel/', '')).toBe('ru');
    expect(langOfLocation('/features/angel/', '')).toBe('en');
    expect(langOfLocation('/', '#view=features&lang=ru')).toBe('ru');
  });

  it('links a feature by its path and everything else by the hash on the root', () => {
    expect(urlOfRoute({ point: {}, view: 'feature', item: 'angel' }, 'en')).toBe('/features/angel/');
    expect(urlOfRoute({ point: {}, view: 'feature', item: 'angel', scene: 'warm' }, 'ru')).toBe('/ru/features/angel/#scene=warm');
    expect(urlOfRoute({ point: { focus: 'jazz' }, view: 'feature', item: 'sea-lion-girls', scene: 'jazz' }, 'en')).toBe('/features/sea-lion-girls/#scene=jazz&focus=jazz');
    expect(urlOfRoute({ point: {}, view: 'features' }, 'ru')).toBe('/ru/features/');
    expect(urlOfRoute({ point: {}, view: 'listen' }, 'ru')).toBe('/#lang=ru&view=listen');
    expect(urlOfRoute({ point: {} }, 'en')).toBe('/');
    expect(urlOfRoute({ point: {}, ch: 'v2' }, 'en', '?x=1')).toBe('/?x=1#ch=v2');
  });

  it('keeps a feature’s own keys when an old link moves to the path', () => {
    expect(extraHashKeys('#view=feature&item=angel&scene=warm&pulse=1&lang=ru')).toBe('pulse=1');
    expect(extraHashKeys('#view=feature&item=forever-changes&lee=1&haptic=switch')).toBe('lee=1&haptic=switch');
    expect(extraHashKeys('#ch=v2')).toBe('');
  });

  it('names the page as its old hash link did, for the review notes', () => {
    expect(hashOfLocation('/features/angel/', '#scene=warm')).toBe('#view=feature&item=angel&scene=warm');
    expect(hashOfLocation('/ru/features/', '')).toBe('#view=features');
    expect(hashOfLocation('/', '#ch=v2')).toBe('#ch=v2');
  });
});
