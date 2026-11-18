import { beforeEach, describe, expect, it } from 'vitest';

// The coordinator only touches the DOM to pause stray media; a stub is enough.
const media: { paused: boolean; pause: () => void }[] = [];
(globalThis as unknown as { document: unknown }).document = { querySelectorAll: () => media };

const { claim, playing, release, stopAll, stopWithin } = await import('../src/lib/sound');

const box = (...inside: object[]) => ({ contains: (x: object) => inside.includes(x) }) as unknown as Element;

describe('one sound at a time', () => {
  let log: string[];
  const source = (id: string, owner?: Element) => claim(id, () => log.push(`stop ${id}`), owner);
  beforeEach(() => {
    stopAll();
    log = [];
    media.length = 0;
  });

  it('starting a source stops the one before, and only that one', () => {
    source('gramophone');
    source('player-1');
    source('listening-room');
    expect(log).toEqual(['stop gramophone', 'stop player-1']);
    expect(playing()).toBe('listening-room');
  });

  it('claiming again as the same source does not stop it', () => {
    source('tr808-1');
    source('tr808-1');
    expect(log).toEqual([]);
  });

  it('a source that stopped by itself is not stopped again', () => {
    source('amen-1');
    release('amen-1');
    source('player-2');
    expect(log).toEqual([]);
  });

  it('closing a panel silences only what sounds inside it', () => {
    const block = {} as Element;
    source('player-3', block as Element);
    stopWithin(box());
    expect(log).toEqual([]);
    stopWithin(box(block));
    expect(log).toEqual(['stop player-3']);
    expect(playing()).toBeNull();
  });

  it('pauses plain media on the page when a source starts', () => {
    const m = { paused: false, pause() { this.paused = true; } };
    media.push(m);
    source('gramophone-1');
    expect(m.paused).toBe(true);
  });
});
