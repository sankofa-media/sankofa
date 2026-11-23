import { expect, it } from 'vitest';
import { kinds, pageContext, validFeedback } from '../src/feedback/model';
it('validates all choices, whitespace, and Unicode character limits', () => {
 for (const k of kinds) expect(validFeedback(k, 'hello', '')).toBe(true);
 expect(validFeedback('unknown', 'hello', '')).toBe(false);
 expect(validFeedback('idea', ' \n ', '')).toBe(false);
 expect(validFeedback('idea', '😀'.repeat(4000), '😀'.repeat(200))).toBe(true);
 expect(validFeedback('idea', '😀'.repeat(4001), '')).toBe(false);
 expect(validFeedback('idea', 'hello', '😀'.repeat(201))).toBe(false);
});
it('captures route context and strips credentials from URLs', () => {
 const page = pageContext('https://sankofa.black/ru/features/angel/?token=secret#scene=touch&review=secret', 'ru', 'light', 390, 844);
 expect(page).toEqual({url:'https://sankofa.black/ru/features/angel/#scene=touch',key:'feature',view:'feature',item:'angel',scene:'touch',language:'ru',theme:'light',viewport:{width:390,height:844}});
 expect(pageContext('https://sankofa.black/cards/sun-ra/', 'en','dark',1440,900).item).toBe('sun-ra');
});

it('keeps atlas coordinates and zoom in shared context', () => {
 const page = pageContext('https://sankofa.black/#zoom=1&t=1900-1950&place=lagos&review=secret', 'en', 'dark', 390, 844);
 expect(page.url).toBe('https://sankofa.black/#zoom=1&t=1900-1950&place=lagos');
 expect(page.view).toBe('atlas');
});
