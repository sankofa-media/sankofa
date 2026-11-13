// The guide ("How to read this museum") and the dedication: prose from
// content/, rendered as plain blocks. Numbers in the guide are filled in at
// run time from the museum's own data.
import { h } from '../../lib/dom';
import { lang } from '../../lib/i18n';
import { fill, type Inline, type ProseDoc, type ProseFile } from './model';

/** The reader's language, or the other one when it is missing. */
export function inLang(f: ProseFile | null): ProseDoc | undefined {
  if (!f) return undefined;
  return lang() === 'ru' ? (f.ru ?? f.en) : (f.en ?? f.ru);
}

function inline(list: Inline[], values: Record<string, string>): (Node | string)[] {
  return list.map((x) => {
    const s = fill(x.s, values);
    if (x.t === 'em') return h('em', {}, s);
    if (x.t === 'strong') return h('strong', {}, s);
    if (x.t === 'unseen') return h('span.unseen', {}, s);
    if (x.t === 'link') {
      const ext = /^https?:/.test(x.href);
      return h('a', ext ? { href: x.href, rel: 'noopener', target: '_blank' } : { href: x.href }, s);
    }
    return s;
  });
}

export function prose(doc: ProseDoc, values: Record<string, string> = {}, cls = 'mx-prose'): HTMLElement {
  return h(
    `div.${cls}`,
    {},
    doc.blocks.map((b) => (b.type === 'quote' ? h('blockquote', {}, ...inline(b.inline, values)) : h(b.type, {}, ...inline(b.inline, values)))),
  );
}
