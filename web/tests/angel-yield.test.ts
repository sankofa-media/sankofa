import { describe, expect, it } from 'vitest';
import { stageYield } from '../src/features/angel/yield';

describe('the pinned picture gives way to a photograph', () => {
  it('stays while the photograph is below the screen', () => {
    expect(stageYield(400, 900, 844)).toBe(0);
    expect(stageYield(400, 844, 844)).toBe(0);
  });
  it('rises as far as the photograph has come up', () => {
    expect(stageYield(400, 700, 844)).toBe(144);
  });
  it('goes no further than its own height and shadow', () => {
    expect(stageYield(400, 100, 844)).toBe(432);
  });
});
