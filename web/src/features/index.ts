// Special-project links use native navigation; old hash routes leave the museum.
import type { App } from '../app';
import { lang, pick } from '../lib/i18n';
import { featurePath } from '../lib/pagePath';

export interface FeatureHooks {
  navigate(view: 'features' | 'feature' | null, item?: string, scene?: string, push?: boolean): void;
  /** Read the museum, this feature included, in the other language. */
  switchLang(): void;
}

export interface Features {
  readonly isOpen: boolean;
  open(view: 'features' | 'feature', item?: string, scene?: string): void;
  close(): void;
}

/** Legacy hash routes navigate to independent pages. Links use native navigation. */
export function installFeatures(_app: App, _hooks: FeatureHooks): Features {
  document.querySelectorAll<HTMLAnchorElement>('.nav-actions [data-features]').forEach(a => {
    a.href = featurePath(undefined, lang());
    a.title = pick({ en: 'Special projects', ru: 'Спецпроекты' });
    a.setAttribute('aria-label', a.title);
  });
  return {
    isOpen: false,
    open(view, item, scene) {
      location.assign(featurePath(view === 'feature' ? item : undefined, lang()) + (scene ? `#scene=${scene}` : ''));
    },
    close() {},
  };
}
