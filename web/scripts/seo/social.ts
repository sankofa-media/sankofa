// Deterministic browser typography with the museum's bundled fonts. No network
// requests: fonts and artwork are embedded, and missing assets fail the build.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { geoNaturalEarth1, geoPath } from 'd3';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeaturesIndex, FeatureData } from '../../src/features/model.ts';
import type { PageLang } from '../../src/lib/pagePath.ts';
import { esc, plain } from './text.ts';

export const SOCIAL_W = 1200;
export const SOCIAL_H = 630;
export const socialPath = (kind: 'home' | 'features' | 'feature', lang: PageLang, id?: string) => `social/${lang}/${kind === 'feature' ? `features/${id}` : kind}.jpg`;
export const MAIN = {
 en: {
  kicker: 'A MUSEUM THAT SHIPS AS A KUBERNETES DISTRIBUTION',
  subtitle: 'Seven centuries of Black culture, from the libraries of Timbuktu to the starships of Sun Ra.',
  bird: 'Sankofa is an Adinkra symbol of the Akan people of Ghana: a bird that turns its head back to take an egg from its own back. Go back and fetch what you left behind.',
 },
 ru: {
  kicker: 'МУЗЕЙ ВНУТРИ ДИСТРИБУТИВА KUBERNETES',
  subtitle: 'Семь веков чёрной культуры — от библиотек Тимбукту до звездолётов Сан Ра.',
  bird: 'Санкофа — символ адинкра у народа акан в Гане: птица, которая оборачивается назад и берёт яйцо со своей спины. Вернись и забери то, что оставил.',
 },
};
export const balancedSubtitle = (lang: PageLang) => MAIN[lang].subtitle.replace(/Sun Ra|Сан Ра/g, s => s.replace(' ', '\u00a0'));
const wordmark = '<span class="wordmark">Sanko<em>f</em>a</span>';
const dataURL = (file: string) => `data:${({ '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string,string>)[extname(file)] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;

function fonts(repo: string): string {
 const font = (family: string, file: string, style = 'normal') => `@font-face{font-family:${family};font-weight:100 900;font-style:${style};src:url('${dataURL(join(repo,'web/src/fonts',file))}')} `;
 return font('Fraunces','fraunces-latin-full-normal.woff2') + font('Fraunces','fraunces-latin-full-italic.woff2','italic') + font('Literata','literata-cyrillic-opsz-normal.woff2') + font('Inter','inter-latin-standard-normal.woff2') + font('InterRU','inter-cyrillic-standard-normal.woff2');
}

function mapArt(repo: string): string {
 const world = JSON.parse(readFileSync(join(repo,'web/node_modules/world-atlas/land-110m.json'),'utf8')) as Topology<{land:GeometryCollection}>;
 const path = geoPath(geoNaturalEarth1().scale(245).translate([640,350]))(feature(world,world.objects.land));
 return `<svg class="map" viewBox="0 0 1200 630"><defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#aaa" stroke-opacity=".1"/></pattern></defs><rect width="1200" height="630" fill="url(#grid)"/><path d="${path}" fill="#353749" stroke="#b59a58" stroke-opacity=".35"/>${[0,1,2,3,4,5].map(i=>`<path d="M${110+i*50} ${100+i*45} Q${590-i*60} ${-130+i*45} ${1070-i*32} ${370+i*40}" fill="none" stroke="${['#d8ad4b','#71998a','#897cbb'][i%3]}" stroke-opacity=".5" stroke-width="2"/>`).join('')}</svg>`;
}

export async function renderSocial(dist: string, repo: string, index: FeaturesIndex, data: Record<string,FeatureData>): Promise<string[]> {
 const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}) });
 const files: string[] = [];
 try {
  const page = await browser.newPage({viewport:{width:SOCIAL_W,height:SOCIAL_H},deviceScaleFactor:1});
  await page.route('http://**/*', route => route.abort());
  await page.route('https://**/*', route => route.abort());
  const css = `${fonts(repo)}
   *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0c0d18;color:#f3ecdb;font-family:Inter,InterRU,sans-serif}
   .map{position:absolute;inset:0;width:100%;height:100%;opacity:.6}.shade{position:absolute;inset:0;background:linear-gradient(90deg,#0c0d18dd,#0c0d1844),linear-gradient(0deg,#0c0d18,transparent)}
   .content{position:absolute;inset:48px 56px}.wordmark{font-family:Fraunces,serif;font-weight:400;letter-spacing:-.065em;line-height:1}.wordmark em{color:#e3b34d;font-weight:400}
   .kicker{font-size:19px;letter-spacing:2px;color:#e3b34d;margin:0 0 26px}.main .wordmark{font-size:182px}.subtitle{font-family:Fraunces,Literata,serif;font-size:39px;line-height:1.35;max-width:900px;text-wrap:balance;margin:28px 0 0}
   .domain{font-size:24px;letter-spacing:1px;color:#d4caba}.main .domain{position:absolute;bottom:0;right:0}
   .art{position:absolute;inset:0}.art img{position:absolute;width:100%;height:100%;object-fit:cover}.feature .shade{background:linear-gradient(0deg,#080913fa 0%,#080913b0 42%,transparent 85%),linear-gradient(90deg,#08091388,transparent)}
   .feature .content{display:flex;flex-direction:column;justify-content:end}.feature h1{font-family:Fraunces,Literata,serif;font-weight:450;letter-spacing:-.035em;font-size:76px;line-height:1.12;margin:0 0 28px;max-width:1088px;text-wrap:balance}.brand{display:flex;align-items:baseline;gap:28px}.brand .wordmark{font-size:48px}
   .list .wordmark{font-size:118px}.strip{position:absolute;left:56px;right:56px;top:280px;height:240px;display:flex;gap:16px}.tile{position:relative;flex:1;overflow:hidden;border:1px solid #b6974b55}.list .domain{position:absolute;bottom:44px;right:56px}
  `;
  const arts = new Map(index.features.map(e => {
   const layers = e.seo?.image ? [e.seo.image] : (e.cover?.layers ?? []).map(l=>l.file);
   if (!layers.length) throw new Error(`Missing social cover: ${e.id}`);
   return [e.id, `<div class="art">${layers.map(f=>`<img src="${dataURL(join(dist,'media/features',e.id,f))}" alt="">`).join('')}</div>`];
  }));
  const draw = async (path: string, lang: PageLang, cls: string, html: string) => {
   await page.setContent(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>${css}</style><body class="${cls}">${html}</body></html>`);
   await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode())); });
   if (cls === 'feature') {
    const fits = await page.locator('h1').evaluate(el => {
     for (let size=76;size>=56;size-=2) { el.style.fontSize=`${size}px`; if (el.getBoundingClientRect().height <= size*1.12*2+1) return true; }
     // A modest width adjustment keeps long editorial titles intact.
     el.style.width = '1208px'; el.style.maxWidth = 'none'; el.style.transform = 'scaleX(.9)'; el.style.transformOrigin = 'left bottom';
     return el.getBoundingClientRect().height <= 56*1.12*2+1;
    });
    if (!fits) throw new Error(`Social title exceeds two lines at 56px: ${path}`);
   }
   mkdirSync(dirname(join(dist,path)),{recursive:true});
   await page.screenshot({path:join(dist,path),type:'jpeg',quality:86});
   files.push(path);
  };
  for (const lang of ['en','ru'] as const) {
   // Omit the long bird paragraph: even at 26px it crowds the preview.
   await draw(socialPath('home',lang),lang,'main',`${mapArt(repo)}<div class="shade"></div><main class="content"><p class="kicker">${MAIN[lang].kicker}</p>${wordmark}<p class="subtitle">${esc(balancedSubtitle(lang))}</p><span class="domain">sankofa.black</span></main>`);
   await draw(socialPath('features',lang),lang,'list',`${mapArt(repo)}<div class="shade"></div><main class="content"><p class="kicker">${lang==='en'?'Special projects':'Спецпроекты'}</p>${wordmark}</main><div class="strip">${index.features.slice(0,3).map(e=>`<div class="tile">${arts.get(e.id)}</div>`).join('')}</div><span class="domain">sankofa.black</span>`);
   for (const e of index.features) await draw(socialPath('feature',lang,e.id),lang,'feature',`${arts.get(e.id)}<div class="shade"></div><main class="content"><h1>${esc(plain((data[e.id]?.title ?? e.title)[lang]))}</h1><div class="brand">${wordmark}<span class="domain">sankofa.black</span></div></main>`);
  }
 } finally { await browser.close(); }
 return files;
}
