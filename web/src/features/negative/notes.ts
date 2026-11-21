import { h } from '../../lib/dom';
import { lang, pick } from '../../lib/i18n';
import { notes, sendNote, deleteNote } from '../angel/api';

const say = (en: string, ru: string) => pick({ en, ru });

export function readerNotes(): { el: HTMLElement; dispose: () => void } {
  let disposed = false;
  let next = 0;
  const el = h('section.ng-notes', { hidden: true, 'aria-label': say('Reader notes', 'Заметки читателей') });
  const input = h('textarea', { id: 'negative-note', maxlength: 600, rows: 5, required: true }) as HTMLTextAreaElement;
  const send = h('button.btn', { type: 'submit' }, say('Send', 'Отправить')) as HTMLButtonElement;
  const receipt = h('div.ng-note-receipt', { role: 'status' });
  const list = h('div.ng-note-list');
  const more = h('button.btn', { type: 'button', hidden: true, onclick: () => { void load(true); } }, say('More notes', 'Ещё заметки')) as HTMLButtonElement;
  const form = h('form.ng-note-form', {},
    h('label', { for: 'negative-note' }, say('A story from your family', 'История вашей семьи')),
    h('p.ft-caption', {}, say('Cultures meeting, a move, or “where are you from?” when a form had no room for the answer. Up to 600 characters, anonymously, without names, contacts or links.', 'Встреча культур, переезд или «откуда вы?», когда ответ не помещался в анкету. До 600 знаков, анонимно, без имён, контактов и ссылок.')),
    input, send);
  async function load(append = false) {
    more.disabled = true;
    const result = await notes(lang(), append ? next : 0);
    if (disposed) return;
    more.disabled = false;
    if (!result) return;
    el.hidden = false;
    if (!append) list.replaceChildren();
    for (const note of result.notes) {
      list.append(h('article.ng-note', {}, h('p', { lang: note.translation ? lang() : note.lang }, note.translation || note.text)));
    }
    next = result.next;
    more.hidden = !next;
  }
  const codeInput = h('input', { type: 'text', autocomplete: 'off', 'aria-label': say('Delete code', 'Код удаления'), required: true }) as HTMLInputElement;
  const removeStatus = h('p', { role: 'status' });
  const removeButton = h('button.btn', { type: 'submit' }, say('Remove', 'Убрать')) as HTMLButtonElement;
  const removeForm = h('form.ng-note-delete', {}, codeInput, removeButton, removeStatus);
  removeForm.addEventListener('submit', async e => {
    e.preventDefault();
    removeButton.disabled = true;
    const ok = await deleteNote(codeInput.value.trim());
    if (disposed) return;
    removeButton.disabled = false;
    removeStatus.textContent = ok ? say('Removed.', 'Убрано.') : say('Could not remove. Check the code and try again.', 'Не удалось убрать. Проверьте код и попробуйте ещё раз.');
    if (ok) { codeInput.value = ''; receipt.replaceChildren(); await load(); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!input.value.trim() || send.disabled) return;
    send.disabled = true;
    const code = await sendNote(input.value, lang());
    if (disposed) return;
    send.disabled = false;
    if (!code) { receipt.textContent = say('Could not send. Try again later.', 'Не удалось отправить. Попробуйте позже.'); return; }
    input.value = '';
    codeInput.value = code;
    receipt.replaceChildren(h('p', {}, say('Received.', 'Получено.')), h('p', {}, say('Keep your delete code: ', 'Сохраните код удаления: '), h('code', {}, code)));
    await load();
  });
  el.append(h('h3', {}, say('Reader notes', 'Заметки читателей')), form, receipt, list, more,
    h('details.ng-note-remove', {}, h('summary', {}, say('remove', 'убрать')), removeForm));
  void load();
  return { el, dispose: () => { disposed = true; } };
}
