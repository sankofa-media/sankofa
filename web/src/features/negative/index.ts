// Negative: a plate develops, the instruments fail, and the glass turns once.
import { h } from '../../lib/dom';
import { pick } from '../../lib/i18n';
import { claim, release, adopt } from '../../lib/sound';
import { miniPlayer } from '../../views/miniPlayer';
import { Kit } from '../engine/kit';
import { onCalm } from '../engine/calm';
import type { FeatureContext, FeatureInstance } from '../host';
import type { Scene } from '../model';
import '../engine/engine.css';
import './negative.css';

const say = (en: string, ru: string) => pick({ en, ru });
const STAGES = ['contour', 'fills', 'ground', 'full'];
const ALBUM = 'https://melody.su/catalog/folklore/769/';
const tracks = [
  { n: 21, apple: '1691528880', en: 'Abkhaz wedding sequence', ru: 'Абхазская свадебная', artist: { en: 'Vasily Tsargush · State Folk Song Ensemble of Abkhazia', ru: 'Василий Царгуш · Государственный ансамбль народной песни Абхазии' } },
  { n: 4, apple: '1691528666', en: 'Radeda', ru: 'Радеда', artist: { en: 'Arsen Vozba · Afyrtyn', ru: 'Арсен Возба · Афыртын' } },
  { n: 12, apple: '1691528866', en: 'Wedding song', ru: 'Свадебная песня', artist: { en: 'Dzheni Shaadat · Nartaa', ru: 'Джени Шаадат · Нартаа' } },
  { n: 9, apple: '1691528682', en: 'Song of Ozbak II', ru: 'Песня Озбака II', artist: { en: 'Ferzba family, Kutol', ru: 'Семья Ферзба, Кутол' } },
];

export function mount(ctx: FeatureContext): FeatureInstance {
  const kit = new Kit(ctx);
  const root = ctx.root;
  root.classList.add('negative');
  kit.circlePlace = () => 'hidden';
  ctx.tools.replaceChildren();
  let manualCalm = false;
  let disposed = false;
  const calm = () => manualCalm || kit.calm;
  const cleanups: (() => void)[] = [];
  const refreshers: (() => void)[] = [];
  const button = (en: string, ru: string, action: () => void, cls = '') => h(`button.btn.${cls || 'ng-control'}`, { type: 'button', onclick: action }, say(en, ru));
  const link = (url: string, label: string) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
  const calmButton = button('Calm mode', 'Спокойный режим', () => {
    manualCalm = !manualCalm;
    updateCalm();
  }, 'ng-calm');
  const updateCalm = () => {
    root.classList.toggle('ng-calm-on', calm());
    if (calm()) flipAnimation?.cancel();
    calmButton.setAttribute('aria-pressed', String(calm()));
    refreshers.forEach(fn => fn());
  };
  ctx.tools.append(calmButton);
  cleanups.push(onCalm(updateCalm));

  // A label-linked native album player participates in the museum coordinator.
  const dock = h('aside.ng-dock', { hidden: true, 'aria-label': say('Official recording', 'Официальная запись') });
  root.append(dock);
  const closeDock = () => { dock.replaceChildren(); dock.hidden = true; root.classList.remove('ng-player-on'); release('negative-album'); };
  const play = (index: number) => {
    const track = tracks[index];
    if (index === 0) {
      miniPlayer().play([{ ref: 'feature:negative-wedding', label: pick(track.artist), rec: { source: 'youtube', kind: 'official', youtube: '6OmxlX_dg-4', title: pick(track), channel: 'Мелодия · MEL CD 3001643 / 21' } }], 0);
      return;
    }
    claim('negative-album', closeDock, root);
    dock.hidden = false;
    root.classList.add('ng-player-on');
    dock.replaceChildren(button('Close player', 'Закрыть плеер', closeDock),
      h('p', {}, `${pick(track.artist)} · ${pick(track)} · MEL CD 3001643 / ${track.n}`),
      h('iframe', { src: `https://embed.music.apple.com/ru/album/1691528658?i=${track.apple}`, title: pick(track), allow: 'autoplay; encrypted-media', height: '175' }),
      link(ALBUM, say('Melodiya · full album and listening services', 'Мелодия · альбом и музыкальные сервисы')));
  };
  const musicButtons = () => h('div.ng-tracks', {}, ...tracks.map((t, i) => button(`${t.n}. ${t.en}`, `${t.n}. ${t.ru}`, () => play(i))),
    h('p.ft-caption', {}, say('Music of the region, not the voices of the photographed family. Native players may require an account or offer previews.', 'Музыка края, не голоса семьи на снимке. Официальные плееры могут предлагать превью или требовать аккаунт.')),
    link(ALBUM, say('Melodiya · MEL CD 3001643', 'Мелодия · MEL CD 3001643')));
  cleanups.push(closeDock);

  const image = (file: string, cls = '') => h(`img.${cls || 'ng-layer'}`, { 'data-src': kit.artSrc(file), alt: '', decoding: 'async', draggable: 'false' });
  const photo = (id: string) => {
    const p = kit.photo(id);
    return p ? h('figure.ng-photo', {}, h('img', { 'data-src': p.src, alt: p.alt, decoding: 'async' }), h('figcaption', {}, p.caption ?? '', ' ', link(p.source!, p.credit))) : null;
  };

  // The supplied stages are components: ground below fills below contour.
  const develop = (sc: Scene, name: string) => {
    const el = h('div.ng-picture', { 'data-picture': name, 'data-stage': 'contour', style: `aspect-ratio:${sc.art?.aspect ?? '3 / 2'}` },
      ...['ground', 'fills', 'contour', 'full'].map(stage => {
        const img = image(`${name}-${stage}.png`, `ng-${stage}`);
        if (stage === 'full') img.setAttribute('alt', pick(sc.name as { en: string; ru: string }));
        return img;
      }));
    let current = 0;
    let wanted = 0;
    let timer = 0;
    const advance = () => {
      timer = 0;
      if (disposed) return;
      if (current < wanted) {
        current = calm() ? wanted : current + 1;
        el.dataset.stage = STAGES[current];
        if (current < wanted) timer = window.setTimeout(advance, 2400);
      }
    };
    const progress = (p: number) => {
      wanted = calm() ? 3 : Math.max(wanted, Math.min(3, Math.floor(p * 5)));
      if (calm()) { clearTimeout(timer); timer = 0; advance(); }
      else if (wanted > current && !timer) timer = window.setTimeout(advance, 2400);
    };
    refreshers.push(() => progress(0));
    cleanups.push(() => clearTimeout(timer));
    return { el, progress };
  };

  let flipped = false;
  let flipAnimation: Animation | undefined;
  let stream: MediaStream | null = null;
  let cameraEpoch = 0;
  const stopCamera = () => { cameraEpoch++; stream?.getTracks().forEach(t => t.stop()); stream = null; };
  cleanups.push(stopCamera);
  cleanups.push(() => flipAnimation?.cancel());
  const visibility = () => { if (document.hidden) stopCamera(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', stopCamera);
  cleanups.push(() => window.removeEventListener('pagehide', stopCamera));
  cleanups.push(() => document.removeEventListener('visibilitychange', visibility));

  for (const sc of ctx.data.scenes) {
    const names = sc.pictures as string[];
    const pictures = names.map(name => develop(sc, name));
    const gallery = h('div.ng-gallery', {}, ...pictures.map(p => p.el));
    pictures.forEach((p, i) => p.el.hidden = i !== 0);
    const after: (Node | null)[] = [];
    let customProgress = (_p: number) => {};
    if (sc.photo) after.push(photo(sc.photo));
    if (sc.id === 'observer') after.push(button('Take the instruments', 'Взять инструменты', () => kit.goTo('caliper')));

    if (sc.id === 'caliper') {
      const parts = sc.art!.overlays!;
      const motion = h('div.ng-motion.ng-caliper-scene', {}, ...parts.filter(l => !/caliper-body|jaw-|tick-/.test(l.file)).map(l => image(l.file)));
      const tool = h('div.ng-caliper', { 'data-tries': '0' }, ...parts.filter(l => /caliper-body|jaw-|tick-/.test(l.file)).map((l, i) => {
        const img = image(l.file); img.style.setProperty('--piece', String(i)); return img;
      }));
      motion.append(tool);
      pictures[0].el.append(motion);
      const status = h('p.ng-status', { role: 'status' });
      let tries = 0;
      let dragging: { x: number; y: number; pointer: number } | null = null;
      const attempt = () => {
        if (tries >= 3) return;
        tries++;
        tool.dataset.tries = String(tries);
        tool.style.transform = '';
        status.textContent = tries === 3 ? say('The caliper falls apart.', 'Штангенциркуль рассыпался.') : say(`It slips. Attempt ${tries} of 3.`, `Соскальзывает. Попытка ${tries} из 3.`);
        if (!calm() && tries < 3) tool.animate([{ transform: 'translate(0, 0)' }, { transform: 'translate(8%, 16%) rotate(9deg)' }, { transform: 'none' }], { duration: 900 });
      };
      const handle = button('Drag the caliper onto a face', 'Перетащите циркуль на лицо', () => {}, 'ng-handle');
      handle.setAttribute('aria-describedby', 'negative-caliper-status'); status.id = 'negative-caliper-status';
      handle.addEventListener('pointerdown', e => { if (tries >= 3) return; dragging = { x: e.clientX, y: e.clientY, pointer: e.pointerId }; handle.setPointerCapture(e.pointerId); });
      handle.addEventListener('pointermove', e => { if (dragging) tool.style.transform = `translate(${e.clientX - dragging.x}px, ${e.clientY - dragging.y}px)`; });
      handle.addEventListener('pointerup', e => {
        if (!dragging) return;
        const r = pictures[0].el.getBoundingClientRect();
        const moved = Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) > 12;
        dragging = null; tool.style.transform = '';
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const faces = [[.22, .43], [.33, .41], [.46, .57], [.58, .35], [.73, .43], [.84, .5]];
        if (moved && faces.some(([fx, fy]) => Math.abs(x - fx) < .07 && Math.abs(y - fy) < .1)) attempt();
      });
      handle.addEventListener('pointercancel', () => { dragging = null; tool.style.transform = ''; });
      pictures[0].el.append(handle);
      after.push(button('Try measuring a face', 'Попробовать измерить лицо', attempt, 'ng-try'), status);
    }

    if (sc.id === 'form') {
      const input = h('input', { id: 'negative-origin', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '200' }) as HTMLInputElement;
      const answer = h('blockquote.ng-answer', { hidden: true, role: 'status' });
      const form = h('form.ng-form', { autocomplete: 'off' }, h('label', { for: input.id }, say('Where are you from?', 'Откуда вы?')), input,
        h('button.btn', { type: 'submit' }, say('Answer', 'Ответить')));
      form.addEventListener('submit', e => {
        e.preventDefault();
        input.value = '';
        input.disabled = true;
        form.querySelector('button')!.disabled = true;
        answer.hidden = false;
        answer.textContent = say('“Abkhaz, of course. I was born and grew up here. This is my home…” — Nutsa Abash, MK, 2003.', '«Абхазкой, конечно. Я здесь родилась и выросла. Это — мой дом...» — Нуца Абаш, «МК», 2003.');
        pictures[0].el.hidden = true; pictures[1].el.hidden = false;
        pictures[1].progress(1);
        gallery.classList.add('ng-torn');
      });
      after.push(form, answer, h('p.ft-caption', {}, say('Your input is neither stored nor sent.', 'Введённое не сохраняется и не отправляется.')));
    }

    if (sc.id === 'river') {
      const pins = h('div.ng-map-pins', {}, button('Sukhum · listen', 'Сухум · слушать', () => play(1)), button('Adzyubzha · listen', 'Адзюбжа · слушать', () => play(0)));
      pictures[0].el.append(pins);
      const status = say('Name from lists; not independently confirmed.', 'Название из списков, не подтверждено независимо.');
      after.push(h('div.ng-dotted', {}, ...['Кындыг / Kyndyg','Тамыш / Tamysh','Поквеш / Pokvesh','Меркула / Merkula','Члоу / Chlou','Тхина / Tkhina','Река / Reka','Илор / Ilor','Ачандара / Achandara'].map(name => h('details', {}, h('summary', {}, name), h('p', {}, status)))), musicButtons());
    }

    if (sc.id === 'chorus') {
      const motion = h('div.ng-motion.ng-chorus', {}, ...sc.art!.overlays!.map(l => {
        const img = image(l.file);
        const row = /singer-(\d)-/.exec(l.file)?.[1];
        if (row) img.dataset.row = row;
        return img;
      }));
      pictures[0].el.append(motion);
      const labels = h('p.ng-chorus-label', {}, say('Shirin · 1958', 'Ширин · 1958'));
      pictures[0].el.append(labels);
      let raised = false;
      const raise = button('Raise the bowl', 'Поднять чашу', () => { raised = true; customProgress(1); play(0); }, 'ng-tamada');
      pictures[0].el.append(raise);
      customProgress = p => {
        const rows = calm() || raised ? 3 : Math.max(0, Math.min(3, Math.floor((p - .45) * 7)));
        motion.dataset.rows = String(rows);
        motion.querySelectorAll<HTMLElement>('[data-row]').forEach(el => el.style.opacity = Number(el.dataset.row) <= rows ? '1' : '0');
        labels.textContent = [say('Shirin · 1958', 'Ширин · 1958'), say('Nutsa · 2003', 'Нуца · 2003'), say('Shamil · 1973 / c.1995 (2020)', 'Шамиль · 1973 / ок. 1995 (2020)'), say('Diana · 2017', 'Диана · 2017')].slice(0, rows + 1).join(' · ');
      };
      after.push(musicButtons());
    }

    if (sc.id === 'versions') {
      const motion = h('div.ng-motion.ng-routes', {}, ...sc.art!.overlays!.map(l => {
        const img = image(l.file); const route = /(?:route|lens)-(\d)/.exec(l.file)?.[1];
        if (route) img.dataset.route = route;
        return img;
      }));
      pictures[0].el.append(motion);
      const versions = [
        ['Ottoman slave trade', 'Османская работорговля', 'Researchers’ principal explanation', 'Основная версия исследователей'],
        ['Shipwreck', 'Кораблекрушение', 'Legend', 'Легенда'],
        ['Colchians', 'Колхи', 'Hypothesis; unconfirmed', 'Гипотеза, не подтверждено'],
        ['A tsar’s gift', 'Дар царя', 'Family tradition', 'Семейное предание'],
        ['Peter and Gannibal', 'Пётр и Ганнибал', 'Unconfirmed', 'Не подтверждено'],
        ['Narts', 'Нарты', 'Epic legend', 'Легенда эпоса'],
        ['Sudanese mercenaries', 'Суданские наёмники', 'Unconfirmed', 'Не подтверждено'],
      ];
      const status = h('p.ng-status', { role: 'status' });
      const facsimile = h('aside.ng-facsimile', {}, h('p', {}, say('E. Markov’s letter, Kavkaz, no. 78, 4 April 1913, p. 3. Public domain. Facsimile not available locally.', 'Письмо Е. Маркова, «Кавказ», № 78, 4 апреля 1913, с. 3. Общественное достояние. Факсимиле пока нет в локальной коллекции.')),
        link('https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Kavkaz_1913_N78.pdf/page3-1920px-Kavkaz_1913_N78.pdf.jpg', say('Open the source page', 'Открыть страницу источника')));
      const controls = versions.map((v, i) => button(v[0], v[1], () => select(i), 'ng-lens'));
      const select = (i: number) => {
        controls.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
        motion.querySelectorAll<HTMLElement>('[data-route]').forEach(el => el.hidden = Number(el.dataset.route) !== i + 1);
        status.textContent = say(versions[i][2], versions[i][3]);
        facsimile.hidden = i !== 0;
      };
      select(0);
      after.push(h('div.ng-lenses', {}, ...controls), status, facsimile);
    }

    if (sc.id === 'family') after.push(button('Watch Maxim Samarin’s film (2022)', 'Смотреть фильм Максима Самарина (2022)', () => {
      miniPlayer().play([{ ref: 'feature:negative-film', label: 'Максим Самарин · 2022', rec: { source: 'youtube', kind: 'official', youtube: '-C9ksZ0Z9T4', title: 'Абхазские негры', channel: 'Максим Самарин' } }], 0);
    }), link('https://www.youtube.com/watch?v=-C9ksZ0Z9T4', say('Official director upload', 'Официальная загрузка режиссёра')));

    if (sc.id === 'reverse-camera') {
      const video = h('video.ng-reflection', { muted: true, playsinline: true, 'aria-label': say('Your local reflection', 'Ваше локальное отражение'), hidden: true }) as HTMLVideoElement;
      video.muted = true; adopt(video);
      pictures[0].el.append(video, h('div.ng-glint', { 'aria-hidden': 'true' }));
      const status = h('p.ng-status', { role: 'status' });
      const enable = button('Show my reflection', 'Показать моё отражение', async () => {
        stopCamera(); const epoch = cameraEpoch;
        try {
          const pending = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
          if (disposed || epoch !== cameraEpoch || document.hidden) { pending.getTracks().forEach(t => t.stop()); return; }
          stream = pending; video.srcObject = stream; video.hidden = false; await video.play();
          status.textContent = say('Only on this device. Nothing is recorded or sent.', 'Только на этом устройстве. Ничего не записывается и не отправляется.');
        } catch { stopCamera(); video.hidden = true; status.textContent = say('The glass keeps its glint. The camera is off.', 'На стекле остаётся блик. Камера выключена.'); }
      });
      after.push(enable, button('Turn camera off', 'Выключить камеру', () => { stopCamera(); video.srcObject = null; video.hidden = true; status.textContent = say('Camera off', 'Камера выключена'); }), status,
        h('p.ft-caption', {}, say('Optional front camera. The picture stays on your device.', 'Фронтальная камера — по желанию. Изображение остаётся на вашем устройстве.')));
    }
    if (sc.id === 'door') after.push(h('button.btn.ng-notes', { type: 'button', disabled: true, 'data-notes-enabled': 'false' }, say('Reader notes · coming later', 'Заметки читателей · позже')));
    if (sc.id === 'final') after.push(h('details.ng-credits', {}, h('summary', {}, say('Sources and credits', 'Источники и кредиты')),
      h('p', {}, say('Illustrations generated in the tradition of Senegalese reverse-glass painting. Contemporary interpretations, not historical portraits.', 'Иллюстрации сгенерированы в технике сенегальского сувера. Современные интерпретации, не исторические портреты.')),
      h('p', {}, say('Family group: REM 3338-7, via Wikimedia Commons; reproduced by Kovalevsky in 1914 and cited by Gavrishina and Mikhailova in 2017. Sukhum: Sergei Prokudin-Gorsky, Library of Congress.', 'Семейная группа: РЭМ 3338-7, через Wikimedia Commons; публикация Ковалевского 1914 года и цитирование Гавришиной и Михайловой 2017 года. Сухум: Сергей Прокудин-Горский, Библиотека Конгресса.')),
      link(ALBUM, 'Мелодия · MEL CD 3001643 · 1970–1987 / 2009'),
      h('p', {}, say('Confirmed across sources: occupations, self-identification and particular family relationships. Arrival dates, numbers and a complete genealogy remain unresolved. Version labels distinguish explanations, hypotheses and legends.', 'Несколькими источниками подтверждены профессии, самоидентификация и отдельные родственные связи. Даты приезда, численность и полная родословная остаются неустановленными. Ярлыки версий различают объяснения, гипотезы и легенды.'))));

    const section = kit.section(sc, { stage: gallery, after, screens: 2.6 });
    root.append(section);
    let lastP = 0;
    const progress = (p: number) => {
      lastP = p;
      let selected = Math.min(pictures.length - 1, Math.floor(p * pictures.length));
      if (sc.id === 'form') selected = gallery.classList.contains('ng-torn') ? 1 : 0;
      if (sc.id === 'words') selected = flipped ? 1 : 0;
      pictures.forEach((picture, i) => {
        picture.el.hidden = i !== selected;
        picture.progress(pictures.length > 1 && !['form', 'words'].includes(sc.id) ? Math.max(0, p * pictures.length - i) : p);
      });
      customProgress(p);
    };
    kit.onProgress(sc.id, progress);
    refreshers.push(() => progress(lastP));
    kit.onEnter(sc.id, () => {
      if (ctx.data.scenes.indexOf(sc) >= 9 && !flipped) {
        flipped = true;
        root.dataset.flipped = 'true';
        root.dataset.flipCount = '1';
        if (!calm()) flipAnimation = ctx.scroller.animate([{ transform: 'perspective(1600px) rotateY(0)' }, { transform: 'perspective(1600px) rotateY(180deg)', offset: .5 }, { transform: 'perspective(1600px) rotateY(360deg)' }], { duration: 2400, easing: 'ease-in-out' });
        progress(lastP);
      }
      if (sc.id !== 'reverse-camera') stopCamera();
    });
  }
  updateCalm();
  kit.start(ctx.scene);
  return { goTo: id => kit.goTo(id), current: () => kit.current(), dispose() { disposed = true; cleanups.forEach(fn => fn()); kit.dispose(); } };
}
