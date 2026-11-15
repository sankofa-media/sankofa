// The museum views added by the mechanics: a document on the desk, the
// Workshop of working objects, the Cabinet of Curiosities, how the facts were
// checked, the guide, the dedication. `objects` is the Workshop's old name:
// links to it still open, and are rewritten to `workshop`.
export const MECH_VIEWS = ['document', 'workshop', 'cabinet', 'objects', 'method', 'guide', 'dedication'] as const;
export type MechView = (typeof MECH_VIEWS)[number];

export function isMechView(v: string | null | undefined): v is MechView {
  return (MECH_VIEWS as readonly string[]).includes(v ?? '');
}

/** The view a name opens: old names lead to their new rooms. */
export function canonicalView(v: MechView): Exclude<MechView, 'objects'> {
  return v === 'objects' ? 'workshop' : v;
}
