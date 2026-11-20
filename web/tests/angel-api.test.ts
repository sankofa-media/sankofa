import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetPulses, pulses, sendPulse, sendWords, words, wordsStatus } from '../src/features/angel/api';

afterEach(() => {
  vi.unstubAllGlobals();
  forgetPulses();
});

describe('Angel without an optional backend', () => {
  it.each(['404', 'html', 'network'])('keeps the museum readable on %s responses', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch');
      return new Response('<html>Not an API</html>', {
        status: failure === '404' ? 404 : 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }));
    expect(await pulses()).toBeNull();
    expect(await words('en')).toEqual([]);
    expect(await sendWords({ text: 'Hello', lang: 'en' })).toBeNull();
    expect(await sendPulse([800, 810])).toBeNull();
    expect(await wordsStatus('test')).toBeNull();
  });
});
