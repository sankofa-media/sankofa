import { expect, it } from 'vitest';
import { balancedSubtitle, socialPath, SOCIAL_W, SOCIAL_H } from '../scripts/seo/social';
it('keeps the final name together in either language', () => {
 for (const lang of ['en','ru'] as const) expect(balancedSubtitle(lang)).toMatch(/\S+\u00a0\S+\.$/);
});
it('separates home, collection and feature pictures by language', () => {
 expect([SOCIAL_W,SOCIAL_H]).toEqual([1200,630]);
 const paths = ['en','ru'].flatMap(lang => ['home','features','feature'].map(kind => socialPath(kind as 'home'|'features'|'feature',lang as 'en'|'ru','angel')));
 expect(new Set(paths).size).toBe(6);
 expect(paths).toContain('social/ru/features/angel.jpg');
});
