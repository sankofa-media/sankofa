import { h, toast } from './dom';
import { pick } from './i18n';

/** A room fetches its collection only when opened; leaving cancels its pending open. */
export function lazyView<T extends { el: HTMLElement; isOpen: boolean; open(...args: any[]): void; close(): void; onClose?: () => void; onArtist?: (id: string | undefined) => void }>(create: () => Promise<T>) {
  let view: T | undefined;
  let pending: Promise<T> | undefined;
  let request = 0;
  const host = h('div');
  document.body.append(host);
  const room = {
    el: host,
    get isOpen() { return view?.isOpen ?? false; },
    onClose: undefined as (() => void) | undefined,
    onArtist: undefined as ((id: string | undefined) => void) | undefined,
    open(...args: Parameters<T['open']>) {
      const mine = ++request;
      pending ??= create().then(v => {
        view = v;
        host.append(v.el);
        v.onClose = () => room.onClose?.();
        v.onArtist = id => room.onArtist?.(id);
        return v;
      }).catch(error => { pending = undefined; throw error; });
      void pending.then(v => { if (mine === request) v.open(...args); }).catch(() => {
        if (mine === request) toast(pick({ en: 'The collection could not load. Please try again.', ru: 'Коллекцию не удалось загрузить. Попробуйте ещё раз.' }));
      });
    },
    close() { ++request; view?.close(); },
  };
  return room;
}
