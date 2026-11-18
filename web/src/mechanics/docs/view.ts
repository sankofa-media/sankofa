// "Document on the desk": the scan lies still while the notes scroll past;
// each note outlines its line on the page. On a phone the page sits in a
// window above the notes and pans and zooms to the line being read.
import type { App } from '../../app';
import { h } from '../../lib/dom';
import { lang, pick } from '../../lib/i18n';
import { mediaSrc } from '../../lib/media';
import { activeIndex, focusTransform, union, type Doc } from './model';

const PHONE = '(max-width: 760px)';

export interface DeskView {
  el: HTMLElement;
  /** Re-read positions; call on scroll of the container. */
  update(): void;
  dispose(): void;
}

export function desk(app: App, d: Doc, scroller: HTMLElement): DeskView {
  const ru = lang() === 'ru';
  const card = app.set.get(d.card);
  let page = -1;
  let active = -1;

  const img = h('img.desk-img', { alt: '', decoding: 'async', draggable: 'false' }) as HTMLImageElement;
  const marks = h('div.desk-marks', { 'aria-hidden': 'true' });
  const paper = h('div.desk-paper', {}, img, marks);
  const win = h('div.desk-window', {}, paper);
  const pageLabel = h('span.desk-page');
  const scan = h('figure.desk-scan', {}, win, h('figcaption.desk-cap', {}, pageLabel));

  const notes = d.lines.map((l, i) =>
    h(
      'article.desk-note',
      { tabindex: '0', 'data-i': String(i), 'aria-label': pick({ en: `Line ${i + 1} of ${d.lines.length}`, ru: `Строка ${i + 1} из ${d.lines.length}` }) },
      h('span.desk-num', { 'aria-hidden': 'true' }, `${i + 1} / ${d.lines.length}`),
      h('blockquote.desk-quote', { lang: 'en' }, l.text),
      ru ? h('p.desk-tr', {}, l.ru) : null,
      h('p.desk-ctx', {}, pick(l.note)),
    ),
  );
  const listAll = h('ol.desk-all', { 'aria-label': pick({ en: 'All highlighted lines', ru: 'Все выделенные строки' }) });

  const showPage = (p: number) => {
    if (p === page) return;
    page = p;
    const pg = d.pages[p];
    const { src, srcset } = mediaSrc(app, pg.file, [1600]);
    paper.classList.add('turning');
    window.setTimeout(() => paper.classList.remove('turning'), 280);
    img.src = src;
    if (srcset) img.srcset = srcset;
    img.sizes = '(max-width: 760px) 220vw, 46vw';
    img.alt = pick({ en: `${d.title.en}, ${pg.label.en}`, ru: `${d.title.ru}, ${pg.label.ru}` });
    paper.style.setProperty('--ar', `${pg.width} / ${pg.height}`);
    paper.style.setProperty('--arn', String(pg.width / pg.height));
    pageLabel.textContent = d.pages.length > 1 ? `${pick(pg.label)} · ${p + 1} / ${d.pages.length}` : pick(pg.label);
    marks.replaceChildren(
      ...d.lines.flatMap((l, i) =>
        l.page !== p
          ? []
          : l.boxes.map(([x, y, w, hh]) => h('i.desk-mark', { 'data-line': String(i), style: `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%` })),
      ),
    );
  };

  const frame = () => {
    const l = d.lines[active];
    if (!l || !window.matchMedia(PHONE).matches) {
      paper.style.transform = '';
      return;
    }
    const pg = d.pages[l.page];
    const vw = win.clientWidth;
    const vh = win.clientHeight;
    const pw = vw;
    const ph = (vw * pg.height) / pg.width;
    const t = focusTransform(union(l.boxes), pw, ph, vw, vh);
    paper.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
  };

  const setActive = (i: number) => {
    if (i === active) return;
    active = i;
    showPage(d.lines[i].page);
    marks.querySelectorAll('.desk-mark').forEach((m) => m.classList.toggle('on', (m as HTMLElement).dataset.line === String(i)));
    notes.forEach((n, k) => n.classList.toggle('on', k === i));
    frame();
  };

  const update = () => {
    const phone = window.matchMedia(PHONE).matches;
    // The reading line sits in the part of the screen the notes are read in:
    // below the scan on a phone, a little above the middle elsewhere.
    const below = win.getBoundingClientRect().bottom;
    const line = phone ? below + (window.innerHeight - below) * 0.45 : window.innerHeight * 0.55;
    setActive(activeIndex(notes.map((n) => n.getBoundingClientRect().top), line));
  };

  notes.forEach((n, i) =>
    n.addEventListener('focus', () => {
      n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setActive(i);
    }),
  );
  // A phone in landscape, a resized window: the zoom is recomputed.
  const onResize = () => frame();
  window.addEventListener('resize', onResize);
  img.addEventListener('load', frame);

  d.lines.forEach((l) => listAll.append(h('li', { lang: 'en' }, l.text)));
  const el = h(
    'article.mx-desk',
    {},
    h(
      'header.mx-head',
      {},
      h('h2', {}, pick(d.title)),
      h('p.mx-lede', {}, pick(d.imprint)),
      card ? h('p.desk-from', {}, pick({ en: 'From the card ', ru: 'Из карточки ' }), h('a', { href: `#focus=${card.id}`, 'data-card': card.id }, card.title)) : null,
    ),
    h('div.desk-stage', {}, h('div.desk-left', {}, scan), h('div.desk-notes', {}, ...notes)),
    h(
      'footer.desk-foot',
      {},
      h('h3', {}, pick({ en: 'The lines on this page', ru: 'Строки на этой странице' })),
      listAll,
      h(
        'p.credit',
        {},
        pick({ en: 'Scan: ', ru: 'Скан: ' }),
        h('a', { href: d.source.url, rel: 'noopener', target: '_blank' }, d.source.title.replace(/^Wikimedia Commons: /, 'Wikimedia Commons · ')),
        ' · ',
        d.source.license === 'Public domain' ? pick({ en: 'public domain', ru: 'общественное достояние' }) : d.source.license,
        d.source.scan ? [' · ', h('a', { href: d.source.scan, rel: 'noopener', target: '_blank' }, pick({ en: 'original scan', ru: 'исходный скан' }))] : null,
      ),
      card ? h('a.btn', { href: `#focus=${card.id}`, 'data-card': card.id }, pick({ en: 'Back to the card', ru: 'Вернуться к карточке' })) : null,
    ),
  );
  scroller.addEventListener('scroll', update, { passive: true });
  setActive(0);
  return {
    el,
    update,
    dispose() {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', onResize);
    },
  };
}
