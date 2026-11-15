// The Arthur Lee mode's pinned button: on screen in every chapter. On a
// phone it opens the mode; on a computer it shows a QR code that opens the
// mode on the reader's phone at the chapter being read (and, below it, a way
// to try it here over a still picture).
import { h } from '../../../lib/dom';
import { lang } from '../../../lib/i18n';
import { encodeQR, qrPath } from '../../engine/qr';
import { leeUrl } from './url';

export function isPhone(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export interface PinOptions {
  host: HTMLElement;
  say(key: string): string;
  /** The chapter being read now. */
  current(): string | undefined;
  open(): void;
}

/** An SVG QR code for `text`. */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const { d, size } = qrPath(encodeQR(text));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'fc-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.dataset.url = text;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', '#000');
  svg.append(bg, p);
  return svg;
}

export class LeePin {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private panel: HTMLElement;
  private code: HTMLElement;
  private link: HTMLAnchorElement;

  constructor(private readonly o: PinOptions) {
    const say = o.say;
    this.btn = h('button.fc-lee-pin', { type: 'button', 'aria-expanded': 'false', title: say('lee-hint') }, h('span.fc-lee-pin-eye', { 'aria-hidden': 'true' }), h('span.fc-lee-pin-tx', {}, say('lee-open'))) as HTMLButtonElement;
    this.code = h('div.fc-lee-code');
    this.link = h('a.fc-lee-link', { target: '_blank', rel: 'noopener' }) as HTMLAnchorElement;
    const here = h('button.btn.fc-lee-here', { type: 'button' }, say('lee-here'));
    here.addEventListener('click', () => {
      this.hide();
      o.open();
    });
    const close = h('button.icon-btn.fc-lee-close', { type: 'button', 'aria-label': say('lee-close') }, '×');
    close.addEventListener('click', () => this.hide(true));
    this.panel = h('div.fc-lee-panel', { role: 'dialog', 'aria-label': say('lee-open'), hidden: true }, close, h('b', {}, say('lee-hint')), this.code, h('p', {}, say('lee-qr')), this.link, here);
    this.panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.hide(true);
    });
    this.btn.addEventListener('click', () => {
      if (isPhone()) return o.open();
      if (this.panel.hidden) this.show();
      else this.hide();
    });
    this.el = h('div.fc-lee-pinbox', {}, this.panel, this.btn);
    o.host.append(this.el);
  }

  /** The link for the chapter being read. */
  url(): string {
    return leeUrl(location.origin + location.pathname, this.o.current(), lang());
  }

  private show(): void {
    this.panel.hidden = false;
    this.refresh();
    this.btn.setAttribute('aria-expanded', 'true');
    (this.panel.querySelector('.fc-lee-here') as HTMLElement).focus({ preventScroll: true });
  }

  hide(focus = false): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    if (focus) this.btn.focus({ preventScroll: true });
  }

  /** The reader moved on: the code follows the chapter. */
  refresh(): void {
    if (this.panel.hidden && this.code.firstChild) return;
    const url = this.url();
    if (this.code.querySelector('svg')?.dataset.url === url) return;
    this.code.replaceChildren(qrSvg(url, this.o.say('lee-qr')));
    this.link.href = url;
    this.link.textContent = url.replace(/^https?:\/\//, '');
  }

  dispose(): void {
    this.el.remove();
  }
}
