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

function isInRange(codePoint: number, start: number, end: number): boolean {
  return codePoint >= start && codePoint <= end;
}

function isHanCodePoint(codePoint: number): boolean {
  return (
    isInRange(codePoint, 0x3400, 0x4dbf) || // CJK Unified Ideographs Extension A
    isInRange(codePoint, 0x4e00, 0x9fff) || // CJK Unified Ideographs
    isInRange(codePoint, 0xf900, 0xfaff) || // CJK Compatibility Ideographs
    isInRange(codePoint, 0x20000, 0x2a6df) || // Extension B
    isInRange(codePoint, 0x2a700, 0x2b73f) || // Extension C
    isInRange(codePoint, 0x2b740, 0x2b81f) || // Extension D
    isInRange(codePoint, 0x2b820, 0x2ceaf) || // Extension E
    isInRange(codePoint, 0x2ceb0, 0x2ebef) // Extension F
  );
}

function isKanaCodePoint(codePoint: number): boolean {
  return (
    isInRange(codePoint, 0x3040, 0x309f) || // Hiragana
    isInRange(codePoint, 0x30a0, 0x30ff) || // Katakana
    isInRange(codePoint, 0x31f0, 0x31ff) || // Katakana Phonetic Extensions
    isInRange(codePoint, 0xff66, 0xff9d) // Halfwidth Katakana
  );
}

function isHangulCodePoint(codePoint: number): boolean {
  return (
    isInRange(codePoint, 0x1100, 0x11ff) || // Hangul Jamo
    isInRange(codePoint, 0x3130, 0x318f) || // Hangul Compatibility Jamo
    isInRange(codePoint, 0xa960, 0xa97f) || // Hangul Jamo Extended-A
    isInRange(codePoint, 0xac00, 0xd7af) || // Hangul Syllables
    isInRange(codePoint, 0xd7b0, 0xd7ff) // Hangul Jamo Extended-B
  );
}

function isLatinCodePoint(codePoint: number): boolean {
  // Fast approximation for Script=Latin letters used by our heuristics.
  return (
    isInRange(codePoint, 0x0041, 0x005a) || // A-Z
    isInRange(codePoint, 0x0061, 0x007a) || // a-z
    isInRange(codePoint, 0x00c0, 0x00d6) || // Latin-1 letters
    isInRange(codePoint, 0x00d8, 0x00f6) ||
    isInRange(codePoint, 0x00f8, 0x00ff) ||
    isInRange(codePoint, 0x0100, 0x024f) || // Latin Extended-A/B
    isInRange(codePoint, 0x1e00, 0x1eff) || // Latin Extended Additional
    isInRange(codePoint, 0x2c60, 0x2c7f) || // Latin Extended-C
    isInRange(codePoint, 0xa720, 0xa7ff) || // Latin Extended-D
    isInRange(codePoint, 0xab30, 0xab6f) // Latin Extended-E
  );
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

    if (isHanCodePoint(codePoint)) {
      han += 1;
      letterLikeChars += 1;
    } else if (isKanaCodePoint(codePoint)) {
      kana += 1;
      letterLikeChars += 1;
    } else if (isHangulCodePoint(codePoint)) {
      hangul += 1;
      letterLikeChars += 1;
    } else if (isLatinCodePoint(codePoint)) {
      latin += 1;
      letterLikeChars += 1;
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

    if (
      isHanCodePoint(codePoint) ||
      isKanaCodePoint(codePoint) ||
      isHangulCodePoint(codePoint) ||
      isLatinCodePoint(codePoint)
    ) {
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

