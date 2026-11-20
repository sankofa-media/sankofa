// On a phone the scene's picture holds the top of the screen and the text
// reads below it. When a photograph or a player in the text column comes up,
// the picture gives way: it rises with the photograph instead of staying
// pinned, so the text keeps the room it had and the photograph gets the
// screen to itself, never two pictures squeezing the words between them.

const PHONE = '(max-width: 720px)';
/** What in the text column takes the screen from the pinned picture. */
const MEDIA = ':scope > .ft-flow :is(.an-inline, .an-versions)';

const phone = (): boolean => typeof matchMedia === 'function' && matchMedia(PHONE).matches;

/**
 * How far a pinned picture is pushed up, in pixels: by as much as
 * its photograph has risen into a screen whose bottom edge is at `bottom`,
 * at most the picture's own height (plus its shadow).
 */
export function stageYield(stageHeight: number, mediaTop: number, bottom: number): number {
  return Math.round(Math.min(Math.max(0, bottom - mediaTop), stageHeight + 32));
}

/** Push the scene's pinned picture away while its photograph comes up (phones only). */
export function yieldStage(scene: HTMLElement, sheet: HTMLElement): void {
  const stage = scene.querySelector<HTMLElement>(':scope > .ft-stage');
  if (!stage) return;
  const media = phone() ? scene.querySelector<HTMLElement>(MEDIA) : null;
  if (!media) {
    stage.style.removeProperty('--an-yield');
    return;
  }
  const px = stageYield(stage.offsetHeight, media.getBoundingClientRect().top, sheet.getBoundingClientRect().bottom);
  stage.style.setProperty('--an-yield', `${px}px`);
}
