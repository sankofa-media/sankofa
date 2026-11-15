// Line drawings for the cabinet: the containers (a chest, a box, a suitcase…),
// the dusty silhouettes of things not yet found, and keys. Drawn in
// currentColor, so they follow the theme. Decorative: always aria-hidden.
import type { ContainerKind, Shape } from './model';

const CONTAINERS: Record<ContainerKind, string> = {
  chest:
    '<path d="M14 40h92v44H14z"/><path d="M14 40c0-14 10-22 46-22s46 8 46 22"/><path d="M14 54h92M30 40v44M90 40v44"/><rect x="53" y="48" width="14" height="14" rx="2"/><circle cx="60" cy="55" r="2"/><path d="M6 60h8M106 60h8"/>',
  box: '<path d="M16 30h88v56H16z"/><path d="M16 30l12-10h88l-12 10M104 86l12-10V20"/><path d="M20 46h80M20 66h80" stroke-dasharray="3 4"/>',
  suitcase:
    '<rect x="12" y="34" width="96" height="52" rx="6"/><path d="M46 34v-8a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v8"/><path d="M12 50h96"/><rect x="26" y="46" width="10" height="8" rx="1"/><rect x="84" y="46" width="10" height="8" rx="1"/><path d="M30 86v4M90 86v4"/>',
  crate:
    '<path d="M12 34h96v52H12z"/><path d="M12 47h96M12 60h96M12 73h96"/><path d="M24 34V24h72v10"/><path d="M30 34l-6-10M90 34l6-10M40 24v10M52 24v10M64 24v10M76 24v10"/>',
  'archive-box':
    '<path d="M14 30h92v56H14z"/><path d="M10 22h100v10H10z"/><rect x="40" y="48" width="40" height="18" rx="1"/><path d="M46 54h28M46 60h20"/><circle cx="96" cy="76" r="3"/>',
  bag: '<path d="M26 40c-6 18-8 36 4 46h60c12-10 10-28 4-46z"/><path d="M26 40h68"/><path d="M40 40c0-16 8-26 20-26s20 10 20 26"/><path d="M34 56c8 4 44 4 52 0M38 70l6 6 6-6 6 6 6-6 6 6 6-6 6 6"/>',
  strongbox:
    '<rect x="16" y="26" width="88" height="62" rx="4"/><rect x="24" y="34" width="72" height="46" rx="2"/><circle cx="60" cy="57" r="11"/><path d="M60 46v4M60 64v4M49 57h4M67 57h4"/><path d="M58 55h4l-1 6h-2z"/><path d="M20 88v4M100 88v4"/>',
  grip: '<path d="M14 46h92l-6 40H20z"/><path d="M14 46c4-10 10-14 46-14s42 4 46 14"/><path d="M46 32c0-10 6-14 14-14s14 4 14 14"/><path d="M60 32v14"/><rect x="54" y="44" width="12" height="8" rx="1"/>',
};

const SHAPE_ART: Record<Shape, string> = {
  paper: '<path d="M14 8h26l10 10v38H14z"/><path d="M40 8v10h10M20 26h24M20 34h24M20 42h16"/>',
  book: '<path d="M10 14c8-4 16-4 22 0v38c-6-4-14-4-22 0zM32 14c6-4 14-4 22 0v38c-8-4-16-4-22 0z"/>',
  photo: '<rect x="10" y="10" width="44" height="44" rx="2"/><circle cx="32" cy="27" r="7"/><path d="M18 48c2-8 8-12 14-12s12 4 14 12"/>',
  drawing: '<rect x="10" y="12" width="44" height="40"/><path d="M18 44l10-14 8 9 6-6 6 11M20 22h12"/>',
  object: '<path d="M32 10l18 10v24L32 54 14 44V20z"/><path d="M14 20l18 10 18-10M32 30v24"/>',
  instrument: '<circle cx="32" cy="40" r="14"/><path d="M32 26V6M28 10h8M26 40h12M29 34v12M35 34v12"/>',
  record: '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="7"/><circle cx="32" cy="32" r="1.5"/><path d="M32 14a18 18 0 0 1 18 18" stroke-dasharray="2 3"/>',
};

const KEY = '<circle cx="16" cy="20" r="10"/><circle cx="16" cy="20" r="4"/><path d="M26 20h30M46 20v8M52 20v6"/>';

function svg(viewBox: string, body: string, cls: string): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', cls);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.6');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.innerHTML = body;
  return el;
}

export const containerArt = (k: ContainerKind) => svg('0 0 120 100', CONTAINERS[k] ?? CONTAINERS.box, `cb-art cb-art-${k}`);
export const silhouette = (s: Shape) => svg('0 0 64 64', SHAPE_ART[s] ?? SHAPE_ART.object, `cb-sil cb-sil-${s}`);
export const keyArt = () => svg('0 0 64 40', KEY, 'cb-key-art');
