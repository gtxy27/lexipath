export function getWordColorClass(partOfSpeech?: string): string {
  if (!partOfSpeech) return 'lexipath-word-default';

  // Handle double part of speech (e.g., noun__verb)
  // For now, we just take the first one or handle it as a specific class
  const primaryPos = partOfSpeech.split('__')[0]?.toLowerCase() ?? '';

  switch (primaryPos) {
    case 'noun':
    case 'n':
      return 'lexipath-word-noun';
    case 'verb':
    case 'v':
      return 'lexipath-word-verb';
    case 'adjective':
    case 'adj':
    case 'a':
      return 'lexipath-word-adj';
    case 'adverb':
    case 'adv':
    case 'r':
      return 'lexipath-word-adv';
    case 'preposition':
    case 'prep':
    case 'p':
      return 'lexipath-word-prep';
    case 'conjunction':
    case 'conj':
    case 'c':
      return 'lexipath-word-conj';
    case 'pronoun':
    case 'pron':
      return 'lexipath-word-pron';
    default:
      return 'lexipath-word-default';
  }
}

export function getWordColor(partOfSpeech?: string, isDark: boolean = false): string {
  if (!partOfSpeech) return isDark ? '#60a5fa' : '#3b82f6'; // default blue

  const primaryPos = partOfSpeech.split('__')[0]?.toLowerCase() ?? '';

  // Color palette inspired by common dictionary/linguistics apps
  switch (primaryPos) {
    case 'noun':
    case 'n':
      return isDark ? '#f87171' : '#ef4444'; // Red
    case 'verb':
    case 'v':
      return isDark ? '#4ade80' : '#22c55e'; // Green
    case 'adjective':
    case 'adj':
    case 'a':
      return isDark ? '#fbbf24' : '#f59e0b'; // Amber
    case 'adverb':
    case 'adv':
    case 'r':
      return isDark ? '#a78bfa' : '#8b5cf6'; // Purple
    case 'preposition':
    case 'prep':
    case 'p':
      return isDark ? '#2dd4bf' : '#14b8a6'; // Teal
    default:
      return isDark ? '#60a5fa' : '#3b82f6'; // Blue
  }
}
