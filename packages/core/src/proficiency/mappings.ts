import type {
  CEFRLevel,
  NativeLanguage,
  ProficiencyPreference,
  ProficiencyStandard,
  SupportedLanguage,
} from '../types';

export type ProficiencyReference = Readonly<{
  standard: ProficiencyStandard;
  value: string;
  note?: string;
}>;

type IeltsRange = Readonly<{
  minInclusive?: number;
  maxInclusive?: number;
  note?: string;
}>;

// Source: IELTS "IELTS and the CEFR" comparison diagram.
// Notes:
// - The published diagram focuses on B1+.
// - A1/A2 are generally below band 4.0 and are left as an open-ended range.
const IELTS_BY_CEFR: Record<CEFRLevel, IeltsRange> = {
  A1: { maxInclusive: 3.5, note: 'A1/A2 通常低于 4.0（仅供参考）' },
  A2: { maxInclusive: 3.5, note: 'A1/A2 通常低于 4.0（仅供参考）' },
  B1: { minInclusive: 4.0, maxInclusive: 5.0 },
  B2: { minInclusive: 5.5, maxInclusive: 6.5, note: '6.5–7.0 为 C1 临界区' },
  C1: { minInclusive: 7.0, maxInclusive: 8.0, note: '8.0–8.5 为 C2 临界区' },
  C2: { minInclusive: 8.5, maxInclusive: 9.0 },
};

function formatIeltsRange(range: IeltsRange): string {
  if (range.minInclusive != null && range.maxInclusive != null) {
    return `${range.minInclusive.toFixed(1)}–${range.maxInclusive.toFixed(1)}`;
  }
  if (range.maxInclusive != null) return `<${(range.maxInclusive + 0.5).toFixed(1)}`;
  if (range.minInclusive != null) return `≥${range.minInclusive.toFixed(1)}`;
  return '未知';
}

export function cefrToIeltsReference(level: CEFRLevel): ProficiencyReference {
  const range = IELTS_BY_CEFR[level];
  return {
    standard: 'IELTS',
    value: formatIeltsRange(range),
    ...(range.note ? { note: range.note } : {}),
  };
}

/**
 * Best-effort conversion for IELTS band scores to CEFR.
 * This is inherently approximate and primarily intended for UX/display.
 */
export function ieltsBandToCefrLevel(band: number): CEFRLevel {
  if (!Number.isFinite(band)) throw new Error('Invalid IELTS band');
  if (band < 0) throw new Error('IELTS band must be >= 0');
  if (band < 4.0) return band < 3.0 ? 'A1' : 'A2';
  if (band <= 5.0) return 'B1';
  if (band <= 6.5) return 'B2';
  if (band <= 8.0) return 'C1';
  return 'C2';
}

export function proficiencyPreferenceToCefrLevel(pref: ProficiencyPreference): CEFRLevel {
  switch (pref.standard) {
    case 'IELTS': {
      const band = Number(pref.value);
      if (!Number.isFinite(band)) throw new Error('Invalid IELTS band value');
      return ieltsBandToCefrLevel(band);
    }
    case 'CET-4':
      return 'B1';
    case 'CET-6':
      return 'B2';
    case 'JLPT': {
      const mapping: Record<string, CEFRLevel> = {
        N5: 'A1',
        N4: 'A2',
        N3: 'B1',
        N2: 'B2',
        N1: 'C1',
      };
      return mapping[pref.value] ?? 'B1';
    }
    case 'TOPIK': {
      const mapping: Record<string, CEFRLevel> = {
        '1': 'A1',
        '2': 'A2',
        '3': 'B1',
        '4': 'B2',
        '5': 'C1',
        '6': 'C2',
      };
      return mapping[pref.value] ?? 'B1';
    }
    default:
      return 'B1';
  }
}

function cefrToJlptReference(level: CEFRLevel): ProficiencyReference {
  // Matches the onboarding mapping (JLPT N1 stops at C1).
  const mapping: Record<CEFRLevel, string> = {
    A1: 'N5',
    A2: 'N4',
    B1: 'N3',
    B2: 'N2',
    C1: 'N1',
    C2: 'N1',
  };
  return {
    standard: 'JLPT',
    value: mapping[level],
    ...(level === 'C2' ? { note: 'JLPT 通常不区分 C1/C2' } : {}),
  };
}

function cefrToTopikReference(level: CEFRLevel): ProficiencyReference {
  const mapping: Record<CEFRLevel, string> = {
    A1: '1',
    A2: '2',
    B1: '3',
    B2: '4',
    C1: '5',
    C2: '6',
  };
  return { standard: 'TOPIK', value: mapping[level] };
}

function cefrToCetReference(
  level: CEFRLevel,
  nativeLanguage: NativeLanguage,
): ProficiencyReference[] {
  // CET is most relevant for Chinese learners of English; keep as a rough hint.
  if (nativeLanguage !== 'zh-CN' && nativeLanguage !== 'zh-TW') return [];

  if (level === 'B1') {
    return [{ standard: 'CET-4', value: '通过', note: '非官方近似：CET-4≈B1（个体差异较大）' }];
  }
  if (level === 'B2') {
    return [{ standard: 'CET-6', value: '通过', note: '非官方近似：CET-6≈B2（个体差异较大）' }];
  }
  return [];
}

export function getProficiencyReferences(input: {
  targetLanguage: SupportedLanguage;
  nativeLanguage: NativeLanguage;
  cefrLevel: CEFRLevel;
}): ProficiencyReference[] {
  const { targetLanguage, nativeLanguage, cefrLevel } = input;

  if (targetLanguage === 'en') {
    return [
      cefrToIeltsReference(cefrLevel),
      ...cefrToCetReference(cefrLevel, nativeLanguage),
    ].filter((ref) => ref.value && ref.value.trim());
  }

  if (targetLanguage === 'ja') return [cefrToJlptReference(cefrLevel)];
  if (targetLanguage === 'ko') return [cefrToTopikReference(cefrLevel)];

  return [];
}
