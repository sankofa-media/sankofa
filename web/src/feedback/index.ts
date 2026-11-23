import './style.css';
import { h } from '../lib/dom';
import { lang, pick } from '../lib/i18n';
import { kinds, pageContext, validFeedback } from './model';

export const strings = {
 button: { en: 'Suggest or correct', ru: 'Предложить или поправить' },
 title: { en: 'Write to the museum', ru: 'Написать музею' },
 correction: { en: 'A correction', ru: 'Поправка' },
 idea: { en: 'An idea or a new special project', ru: 'Идея или новый спецпроект' },
 topic: { en: 'Explain a topic', ru: 'Разобрать тему' },
 other: { en: 'Something else', ru: 'Другое' },
 text: { en: 'What should we fix, add or tell about?', ru: 'Что поправить, добавить или о чём рассказать?' },
 contact: { en: 'How to reach you, if you want an answer (optional)', ru: 'Как с вами связаться, если хотите ответ (необязательно)' },
 send: { en: 'Send', ru: 'Отправить' },
 sent: { en: 'Thank you. We read every message.', ru: 'Спасибо. Мы читаем каждое сообщение.' },
 error: { en: 'The message did not go through. Try again.', ru: 'Сообщение не отправилось. Попробуйте ещё раз.' },
 github: { en: 'You can also open an issue on GitHub.', ru: 'Можно и завести задачу на GitHub.' },
 close: { en: 'Close', ru: 'Закрыть' },
};
const say = (key: keyof typeof strings) => pick(strings[key]);

export function openFeedback(opener: HTMLElement): void {
 const context = pageContext(location.href, lang(), document.documentElement.dataset.theme ?? 'dark', innerWidth, innerHeight);
 const dialog = h('dialog.feedback-dialog', { 'aria-labelledby': 'feedback-title', 'aria-modal': 'true' }) as HTMLDialogElement;
 const text = h('textarea', { required: true, rows: 5, placeholder: say('text'), 'aria-label': say('text') }) as HTMLTextAreaElement;
 const contact = h('input', { type: 'text', 'aria-label': say('contact') }) as HTMLInputElement;
 const status = h('p', { role: 'status', 'aria-live': 'polite' });
 const send = h('button', { type: 'submit' }, say('send')) as HTMLButtonElement;
 const close = h('button', { type: 'button', onclick: () => dialog.close() }, say('close'));
 const form = h('form', {}, h('fieldset', {}, h('legend', {}, say('title')), kinds.map((kind, i) => h('label.feedback-kind', {}, h('input', { type: 'radio', name: 'kind', value: kind, checked: i === 0 }), say(kind)))), text, h('label', {}, say('contact'), contact), send) as HTMLFormElement;
 const validate = () => {
   text.setCustomValidity([...text.value.trim()].length > 4000 || !text.value.trim() ? say('text') : '');
   contact.setCustomValidity([...contact.value].length > 200 ? say('contact') : '');
 };
 form.addEventListener('input', validate);
 form.addEventListener('submit', async e => {
  e.preventDefault();
  const kind = String(new FormData(form).get('kind'));
  validate();
  if (!validFeedback(kind, text.value, contact.value) || !form.reportValidity() || send.disabled) return;
  send.disabled = true;
  status.textContent = '';
  try {
   const r = await fetch('/api/angel/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, text: text.value.trim(), contact: contact.value, page: context }) });
   if (!r.ok) throw new Error(String(r.status));
   form.hidden = true;
   status.textContent = say('sent');
   close.focus();
  } catch { status.textContent = say('error'); send.disabled = false; }
 });
 dialog.append(h('h2', { id: 'feedback-title' }, say('title')), form, status, h('p', {}, h('a', { href: 'https://github.com/sankofa-media/sankofa/issues/new/choose', target: '_blank', rel: 'noopener' }, say('github'))), close);
 dialog.addEventListener('close', () => { dialog.remove(); opener.focus({ preventScroll: true }); });
 // Native modal dialogs isolate focus; explicitly wrap Tab for keyboard users.
 dialog.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('input,textarea,button,a[href]')].filter(el => el.getClientRects().length && !el.matches(':disabled') && (!el.matches('input[type=radio]') || (el as HTMLInputElement).checked));
  const first = focusable[0], last = focusable.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
 });
 document.body.append(dialog);
 dialog.showModal();
}

export function installFeedback(): void {
 // Run before other view listeners so Escape only closes the topmost dialog.
 document.addEventListener('keydown', e => {
  const dialog = document.querySelector<HTMLDialogElement>('.feedback-dialog[open]');
  if (dialog && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dialog.close(); }
 }, true);
 const hosts = 'footer.mx-colophon, .ft-sheet, .drawer .card, .atlas, .mx-body, .engine > .e-wrap, .r-wrap, .l-wrap, .rmap, .descent';
 const add = () => {
  document.querySelectorAll<HTMLElement>(hosts).forEach(host => {
   if (host.querySelector(':scope > .feedback-footer')) return;
   const button = h('button.feedback-button', { type: 'button' }, say('button'));
   button.addEventListener('click', () => openFeedback(button));
   host.append(h('div.feedback-footer', {}, button));
  });
 };
 new MutationObserver(add).observe(document.body, { childList: true, subtree: true });
 add();
}
