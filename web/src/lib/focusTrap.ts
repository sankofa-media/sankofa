// The museum's rooms (the atlas, the listening room, a card, the Cabinet…)
// open over the story. Tab used to walk off the end of a room into the page
// hidden under it, the skip link and the bar behind the sheet, where the
// reader could no longer see where focus was. Tab now goes round inside the
// room on top, the way a dialog keeps it.
const ROOMS = '[aria-modal="true"], section.atlas.open, section.listen.open, section.engine.open, section.descent.open, section.roots.open, section.rmap.open';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, iframe, audio[controls], video[controls], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// checkVisibility also knows what a closed <details> hides; client rects alone do not.
const shown = (el: Element) =>
  (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden') && !el.closest('[hidden], [inert]');

/** The room on top: open, seen, and not covered by another one at its middle. */
export function topRoom(doc: Document = document): HTMLElement | null {
  const rooms = [...doc.querySelectorAll<HTMLElement>(ROOMS)].filter(shown);
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i].getBoundingClientRect();
    const hit = doc.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 40))));
    if (hit && (rooms[i].contains(hit) || !rooms.some((o) => o !== rooms[i] && o.contains(hit)))) return rooms[i];
  }
  return null;
}

export function installFocusTrap(doc: Document = document): void {
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const room = topRoom(doc);
    if (!room) return;
    const items = [...room.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = doc.activeElement as HTMLElement | null;
    const inside = !!at && room.contains(at);
    if (!inside || (!e.shiftKey && at === last) || (e.shiftKey && (at === first || at === room))) {
      e.preventDefault();
      (e.shiftKey && inside ? last : !e.shiftKey && inside ? first : e.shiftKey ? last : first).focus();
    }
  });
}
