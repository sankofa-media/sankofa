// Special projects in the museum: the menu entry, the links and the route.
// Only this stub is in the museum's main bundle; the sheet with the list
// (./host) loads on the first visit, and each feature with its engine loads
// only when it is opened.
import type { App } from '../app';
import { pick } from '../lib/i18n';

export interface FeatureHooks {
  navigate(view: 'features' | 'feature' | null, item?: string, scene?: string, push?: boolean): void;
}

export interface Features {
  readonly isOpen: boolean;
  open(view: 'features' | 'feature', item?: string, scene?: string): void;
  close(): void;
}

export function installFeatures(app: App, hooks: FeatureHooks): Features {
  let host: Features | undefined;
  let loading: Promise<Features> | undefined;
  let wanted: [('features' | 'feature') | null, string?, string?] = [null];
  const load = () => (loading ??= import('./host').then((m) => (host = m.createFeatures(app, hooks))));
  const api: Features = {
    get isOpen() {
      return host?.isOpen ?? wanted[0] !== null;
    },
    open(view, item, scene) {
      wanted = [view, item, scene];
      if (host) return host.open(view, item, scene);
      void load().then((h) => {
        // Closed again, or sent elsewhere, while it loaded.
        if (wanted[0]) h.open(wanted[0], wanted[1], wanted[2]);
      });
    },
    close() {
      wanted = [null];
      host?.close();
    },
  };
  // Links anywhere: <a data-features> opens the list, <a data-feature="id"> one feature.
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const one = t.closest<HTMLElement>('[data-feature]');
    const all = one ? null : t.closest<HTMLElement>('[data-features]');
    if (!one && !all) return;
    e.preventDefault();
    if (one) {
      hooks.navigate('feature', one.dataset.feature, undefined, true);
      api.open('feature', one.dataset.feature);
    } else {
      hooks.navigate('features', undefined, undefined, true);
      api.open('features');
    }
  });
  // The top-bar entry keeps a name when its label folds away.
  document.querySelectorAll<HTMLElement>('.nav-actions [data-features]').forEach((a) => {
    a.setAttribute('aria-label', pick({ en: 'Features: special projects', ru: 'Спецпроекты' }));
    a.title = a.getAttribute('aria-label')!;
  });
  return api;
}
