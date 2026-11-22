import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // pulses() is asked once per module: every case gets a fresh import.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    const { pulses, sendWords, words, wordsStatus } = await import('../src/features/angel/api');
    expect(await pulses()).toBeNull();
    expect(await words('en')).toEqual([]);
    expect(await sendWords({ text: 'Hello', lang: 'en' })).toBeNull();
    expect(await wordsStatus('test')).toBeNull();
  });
});
