// A full-screen sheet over the story, like the engine room: its own bar with
// a kicker and a close button, Escape to close, focus kept inside.
import { h, svgIcon } from '../lib/dom';
import { pick } from '../lib/i18n';

export class Sheet {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private kicker: HTMLElement;
  private returnTo: Element | null = null;
  onClose?: () => void;

  constructor(cls: string) {
    this.kicker = h('span.mx-kicker');
    const close = h('button.icon-btn.mx-close', { type: 'button', 'aria-label': pick({ en: 'Close', ru: 'Закрыть' }), onclick: () => this.onClose?.() }, svgIcon('close'));
    this.body = h('div.mx-body');
    this.el = h(`section.mx-sheet.${cls}`, { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, h('div.mx-bar', {}, this.kicker, close), this.body);
    this.el.addEventListener('keydown', (e) => {
      // A card drawer over the sheet closes first; it handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('.drawer.on')) {
        e.stopPropagation();
        this.onClose?.();
      }
    });
    document.body.append(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  show(kicker: string, label: string, content: HTMLElement): void {
    if (!this.isOpen) this.returnTo = document.activeElement;
    this.kicker.textContent = kicker;
    this.el.setAttribute('aria-label', label);
    this.body.replaceChildren(content);
    this.el.scrollTop = 0;
    this.el.classList.add('open');
    document.body.classList.add('locked');
    this.el.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.isOpen) return;
    this.el.classList.remove('open');
    document.body.classList.remove('locked');
    if (this.returnTo instanceof HTMLElement && this.returnTo.isConnected) this.returnTo.focus({ preventScroll: true });
  }
}
