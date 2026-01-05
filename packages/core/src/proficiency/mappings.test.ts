import { describe, expect, it } from 'vitest';
import { getProficiencyReferences, ieltsBandToCefrLevel, proficiencyPreferenceToCefrLevel } from './mappings';

describe('ieltsBandToCefrLevel', () => {
  it('maps band boundaries', () => {
    expect(ieltsBandToCefrLevel(2.5)).toBe('A1');
    expect(ieltsBandToCefrLevel(3.0)).toBe('A2');
    expect(ieltsBandToCefrLevel(3.5)).toBe('A2');
    expect(ieltsBandToCefrLevel(4.0)).toBe('B1');
    expect(ieltsBandToCefrLevel(5.0)).toBe('B1');
    expect(ieltsBandToCefrLevel(5.5)).toBe('B2');
    expect(ieltsBandToCefrLevel(6.5)).toBe('B2');
    expect(ieltsBandToCefrLevel(7.0)).toBe('C1');
    expect(ieltsBandToCefrLevel(8.0)).toBe('C1');
    expect(ieltsBandToCefrLevel(8.5)).toBe('C2');
  });
});

describe('getProficiencyReferences', () => {
  it('returns IELTS + CET refs for English + Chinese native', () => {
    const refs = getProficiencyReferences({
      targetLanguage: 'en',
      nativeLanguage: 'zh-CN',
      cefrLevel: 'B2',
    });

    expect(refs.some((r) => r.standard === 'IELTS')).toBe(true);
    expect(refs.some((r) => r.standard === 'CET-6')).toBe(true);
  });

  it('returns JLPT refs for Japanese', () => {
    const refs = getProficiencyReferences({
      targetLanguage: 'ja',
      nativeLanguage: 'en',
      cefrLevel: 'B2',
    });

    expect(refs).toEqual([
      { standard: 'JLPT', value: 'N2', note: undefined },
    ]);
  });

  it('returns TOPIK refs for Korean', () => {
    const refs = getProficiencyReferences({
      targetLanguage: 'ko',
      nativeLanguage: 'en',
      cefrLevel: 'C1',
    });

    expect(refs).toEqual([{ standard: 'TOPIK', value: '5' }]);
  });
});

describe('proficiencyPreferenceToCefrLevel', () => {
  it('maps IELTS preference', () => {
    expect(proficiencyPreferenceToCefrLevel({ standard: 'IELTS', value: '6.5' })).toBe('B2');
  });

  it('maps CET preference', () => {
    expect(proficiencyPreferenceToCefrLevel({ standard: 'CET-4', value: 'pass' })).toBe('B1');
    expect(proficiencyPreferenceToCefrLevel({ standard: 'CET-6', value: 'pass' })).toBe('B2');
  });
});
