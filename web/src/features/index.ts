// Special-project links use native navigation; old hash routes leave the museum.
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

/** Enhance the museum's native links without intercepting navigation. */
export function installFeatures(): void {
  document.querySelectorAll<HTMLAnchorElement>('.nav-actions [data-features]').forEach(a => {
    a.href = featurePath(undefined, lang());
    a.title = pick({ en: 'Special projects', ru: 'Спецпроекты' });
    a.setAttribute('aria-label', a.title);
  });
}
