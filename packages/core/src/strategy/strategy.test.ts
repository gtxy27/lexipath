import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAMILIARITY_THRESHOLD,
  buildMasterWords,
  calculateIPlusOneStrategy,
  cefrToProficiencyScore,
  cefrToTier,
  jlptToProficiencyScore,
  proficiencyScoreToTier,
  topikToProficiencyScore,
} from './index';

describe('proficiency mapping', () => {
  it('maps CEFR to 1-10 proficiencyScore', () => {
    expect(cefrToProficiencyScore('A1')).toBe(1);
    expect(cefrToProficiencyScore('A2')).toBe(3);
    expect(cefrToProficiencyScore('B1')).toBe(5);
    expect(cefrToProficiencyScore('B2')).toBe(6);
    expect(cefrToProficiencyScore('C1')).toBe(8);
    expect(cefrToProficiencyScore('C2')).toBe(10);
  });

  it('maps JLPT to 1-10 proficiencyScore', () => {
    expect(jlptToProficiencyScore('N5')).toBe(1);
    expect(jlptToProficiencyScore('N4')).toBe(3);
    expect(jlptToProficiencyScore('N3')).toBe(6);
    expect(jlptToProficiencyScore('N2')).toBe(8);
    expect(jlptToProficiencyScore('N1')).toBe(10);
  });

  it('maps TOPIK to 1-10 proficiencyScore', () => {
    expect(topikToProficiencyScore('1')).toBe(1);
    expect(topikToProficiencyScore('2')).toBe(3);
    expect(topikToProficiencyScore('3')).toBe(5);
    expect(topikToProficiencyScore('4')).toBe(6);
    expect(topikToProficiencyScore('5')).toBe(8);
    expect(topikToProficiencyScore('6')).toBe(10);
  });
});

describe('tier', () => {
  it('maps proficiencyScore to tier', () => {
    expect(proficiencyScoreToTier(1)).toBe('easy');
    expect(proficiencyScoreToTier(3)).toBe('easy');
    expect(proficiencyScoreToTier(4)).toBe('medium');
    expect(proficiencyScoreToTier(7)).toBe('medium');
    expect(proficiencyScoreToTier(8)).toBe('hard');
    expect(proficiencyScoreToTier(10)).toBe('hard');
  });

  it('maps CEFR to tier', () => {
    expect(cefrToTier('A1')).toBe('easy');
    expect(cefrToTier('A2')).toBe('easy');
    expect(cefrToTier('B1')).toBe('medium');
    expect(cefrToTier('B2')).toBe('medium');
    expect(cefrToTier('C1')).toBe('hard');
    expect(cefrToTier('C2')).toBe('hard');
  });
});

describe('masterWords', () => {
  it('splits words into familiar/unfamiliar with default threshold', () => {
    expect(DEFAULT_FAMILIARITY_THRESHOLD).toBe(70);

    const result = buildMasterWords(
      [' Apple ', 'BANANA', 'banana', ''],
      { apple: 80, banana: 69 },
    );

    expect(result).toEqual({ familiar: ['apple'], unfamiliar: ['banana'] });
  });

  it('treats missing familiarity as 0', () => {
    const result = buildMasterWords(['apple'], {});
    expect(result).toEqual({ familiar: [], unfamiliar: ['apple'] });
  });

  it('supports custom threshold', () => {
    const result = buildMasterWords(
      ['apple', 'banana'],
      { apple: 80, banana: 60 },
      { familiarityThreshold: 60 },
    );

    expect(result).toEqual({
      familiar: ['apple', 'banana'],
      unfamiliar: [],
    });
  });
});

describe('calculateIPlusOneStrategy', () => {
  it('returns StrategyOutput (tier + masterWords)', () => {
    const result = calculateIPlusOneStrategy({
      proficiencyLevel: 'B1',
      words: ['Apple', 'banana'],
      familiarityByWord: { apple: 80, banana: 0 },
    });

    expect(result).toEqual({
      tier: 'medium',
      masterWords: { familiar: ['apple'], unfamiliar: ['banana'] },
    });
  });
});

