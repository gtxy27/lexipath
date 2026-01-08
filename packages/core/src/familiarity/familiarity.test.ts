import { describe, expect, it } from 'vitest';
import {
  FAVORITED_MIN_FAMILIARITY,
  LEARNED_FAMILIARITY,
  createInitialWordFamiliarity,
  normalizeWordForFamiliarity,
  recordWordEncounter,
  recordWordFavorited,
  recordWordLearned,
  setWordFamiliarity,
} from './index';

describe('familiarity', () => {
  it('normalizes words consistently', () => {
    expect(normalizeWordForFamiliarity('  Apple ')).toBe('apple');
  });

  it('creates initial record with 0 familiarity', () => {
    const record = createInitialWordFamiliarity('Apple', 123);
    expect(record).toEqual({
      word: 'apple',
      familiarity: 0,
      lastSeen: 123,
      encounters: 0,
    });
  });

  it('records encounters and updates lastSeen', () => {
    const record = createInitialWordFamiliarity('apple', 100);
    const updated = recordWordEncounter(record, 200);
    expect(updated.encounters).toBe(1);
    expect(updated.lastSeen).toBe(200);
    // First encounter gives ~15 familiarity via Ebbinghaus model
    expect(updated.familiarity).toBeCloseTo(15, 0);
  });

  it('clamps familiarity to 0-100', () => {
    const record = createInitialWordFamiliarity('apple', 100);
    expect(setWordFamiliarity(record, -10, 200).familiarity).toBe(0);
    expect(setWordFamiliarity(record, 999, 200).familiarity).toBe(100);
  });

  it('marks favorited as at least the minimum familiarity', () => {
    const record = createInitialWordFamiliarity('apple', 100);
    const updated = recordWordFavorited(record, 200);
    expect(updated.familiarity).toBe(FAVORITED_MIN_FAMILIARITY);
  });

  it('marks learned as 100 familiarity', () => {
    const record = createInitialWordFamiliarity('apple', 100);
    const updated = recordWordLearned(record, 200);
    expect(updated.familiarity).toBe(LEARNED_FAMILIARITY);
  });
});

