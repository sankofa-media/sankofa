import { holdScroll } from './place';

/** Full faces are needed beyond the static introduction and in interactive views. */
export function readingFonts(): void {
  let loaded = false;
  let release: (() => void) | undefined;
  const root = document.documentElement;
  root.classList.add('fonts-pending');
  const load = () => {
    if (loaded) return;
    loaded = true;
    void import('../styles/fonts-full.css').then(async () => {
      await new Promise(requestAnimationFrame);
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    }).catch(() => {}).finally(() => {
      release?.();
      root.classList.remove('fonts-pending');
    });
    window.removeEventListener('scroll', scroll);
  };
  const scroll = () => {
    if (scrollY <= innerHeight / 2) return;
    // Preserve the first jump into the story while the full faces swap in.
    // Otherwise a smooth scroll can finish thousands of pixels before its
    // target when the long page reflows underneath it.
    const middle = innerHeight / 2;
    const anchor = [...document.querySelectorAll<HTMLElement>('.step, .finale, .opener, .coda')].find(el => {
      const rect = el.getBoundingClientRect();
      return rect.top <= middle && rect.bottom >= middle;
    });
    if (anchor) {
      const offset = anchor.getBoundingClientRect().top;
      release = holdScroll(() => anchor.getBoundingClientRect().top + scrollY - offset, { max: 15000, quiet: 15000 });
    }
    load();
  };
  window.addEventListener('scroll', scroll, { passive: true });
  document.addEventListener('click', event => {
    if (!(event.target as Element).closest('[data-lang-switch], [data-theme-toggle]')) load();
  }, { capture: true });
  document.addEventListener('keydown', load, { once: true, capture: true });
  if (/(?:^#|&)(?:focus|view|ch)=/.test(location.hash) || !/^\/(ru\/)?$/.test(location.pathname)) load();
}
