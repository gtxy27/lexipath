type LanguageCharStats = {
  totalChars: number;
  letterLikeChars: number;
  han: number;
  kana: number;
  hangul: number;
  latin: number;
};

type LetterLikeAndSuspiciousStats = {
  letterLikeChars: number;
  hasSuspiciousRepetition: boolean;
};

// Optimized range checking using categorization
const enum CharType {
  Other = 0,
  Han = 1,
  Kana = 2,
  Hangul = 3,
  Latin = 4,
}

// Categorize code point into character type (optimized with single pass)
function categorizeCodePoint(codePoint: number): CharType {
  // Han (CJK) ranges - most common first
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return CharType.Han;
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return CharType.Han;
  
  // Kana ranges - most common first
  if (codePoint >= 0x3040 && codePoint <= 0x309f) return CharType.Kana; // Hiragana
  if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return CharType.Kana; // Katakana
  
  // Hangul - most common first
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) return CharType.Hangul; // Hangul Syllables
  if (codePoint >= 0x1100 && codePoint <= 0x11ff) return CharType.Hangul;
  
  // Latin - most common ranges first
  if (codePoint >= 0x0041 && codePoint <= 0x005a) return CharType.Latin; // A-Z
  if (codePoint >= 0x0061 && codePoint <= 0x007a) return CharType.Latin; // a-z
  if (codePoint >= 0x00c0 && codePoint <= 0x00ff) return CharType.Latin; // Latin-1 extended
  if (codePoint >= 0x0100 && codePoint <= 0x024f) return CharType.Latin; // Latin Extended-A/B
  
  // Less common Han ranges
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return CharType.Han;
  if (codePoint >= 0x20000 && codePoint <= 0x2a6df) return CharType.Han;
  if (codePoint >= 0x2a700 && codePoint <= 0x2b73f) return CharType.Han;
  if (codePoint >= 0x2b740 && codePoint <= 0x2b81f) return CharType.Han;
  if (codePoint >= 0x2b820 && codePoint <= 0x2ceaf) return CharType.Han;
  if (codePoint >= 0x2ceb0 && codePoint <= 0x2ebef) return CharType.Han;
  
  // Less common Kana ranges
  if (codePoint >= 0x31f0 && codePoint <= 0x31ff) return CharType.Kana;
  if (codePoint >= 0xff66 && codePoint <= 0xff9d) return CharType.Kana;
  
  // Less common Hangul ranges
  if (codePoint >= 0x3130 && codePoint <= 0x318f) return CharType.Hangul;
  if (codePoint >= 0xa960 && codePoint <= 0xa97f) return CharType.Hangul;
  if (codePoint >= 0xd7b0 && codePoint <= 0xd7ff) return CharType.Hangul;
  
  // More Latin extended ranges
  if (codePoint >= 0x1e00 && codePoint <= 0x1eff) return CharType.Latin;
  if (codePoint >= 0x2c60 && codePoint <= 0x2c7f) return CharType.Latin;
  if (codePoint >= 0xa720 && codePoint <= 0xa7ff) return CharType.Latin;
  if (codePoint >= 0xab30 && codePoint <= 0xab6f) return CharType.Latin;
  
  return CharType.Other;
}

export function countLanguageCharStats(text: string): LanguageCharStats {
  let totalChars = 0;
  let letterLikeChars = 0;
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;

    totalChars += 1;

    // Single categorization call instead of multiple checks
    const category = categorizeCodePoint(codePoint);
    
    switch (category) {
      case CharType.Han:
        han += 1;
        letterLikeChars += 1;
        break;
      case CharType.Kana:
        kana += 1;
        letterLikeChars += 1;
        break;
      case CharType.Hangul:
        hangul += 1;
        letterLikeChars += 1;
        break;
      case CharType.Latin:
        latin += 1;
        letterLikeChars += 1;
        break;
    }

    index += codePoint > 0xffff ? 2 : 1;
  }

  return { totalChars, letterLikeChars, han, kana, hangul, latin };
}

export function countLetterLikeAndSuspiciousRepetition(text: string): LetterLikeAndSuspiciousStats {
  let letterLikeChars = 0;

  let hasSuspiciousRepetition = false;
  let lastNonSpaceCodePoint = -1;
  let lastRunLength = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;

    // Single categorization call
    const category = categorizeCodePoint(codePoint);
    if (category !== CharType.Other) {
      letterLikeChars += 1;
    }

    // `content.ts` normalizes all whitespace to a single ASCII space.
    if (codePoint === 0x20) {
      lastNonSpaceCodePoint = -1;
      lastRunLength = 0;
    } else if (codePoint === lastNonSpaceCodePoint) {
      lastRunLength += 1;
      if (lastRunLength >= 16) hasSuspiciousRepetition = true;
    } else {
      lastNonSpaceCodePoint = codePoint;
      lastRunLength = 1;
    }

    index += codePoint > 0xffff ? 2 : 1;
  }

  return { letterLikeChars, hasSuspiciousRepetition };
}

