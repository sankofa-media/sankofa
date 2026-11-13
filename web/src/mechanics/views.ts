// The museum views added by the mechanics: a document on the desk, the shelf
// of working objects, how the facts were checked, the guide, the dedication.
export const MECH_VIEWS = ['document', 'objects', 'method', 'guide', 'dedication'] as const;
export type MechView = (typeof MECH_VIEWS)[number];

export function isMechView(v: string | null | undefined): v is MechView {
  return (MECH_VIEWS as readonly string[]).includes(v ?? '');
}
