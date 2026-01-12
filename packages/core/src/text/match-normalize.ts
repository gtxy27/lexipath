/**
 * Lowercase in a way that preserves string length (code units) so indexes remain valid for slicing.
 *
 * JS `toLowerCase()` can expand some characters (e.g. U+0130 "\\u0130"), which breaks offset-based matching.
 */
export function lowerForMatch(input: string): string {
  if (!input) return input;
  const out: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    // Normalize common punctuation to keep matching consistent without changing string length.
    if (code === 0x2018 || code === 0x2019) {
      out.push("'");
      continue;
    }
    if (code === 0x201c || code === 0x201d) {
      out.push('"');
      continue;
    }
    if (code === 0x2013 || code === 0x2014) {
      out.push('-');
      continue;
    }
    if (code === 0x00a0) {
      out.push(' ');
      continue;
    }
    if (code >= 0x41 && code <= 0x5a) {
      out.push(String.fromCharCode(code + 0x20));
      continue;
    }
    if (code === 0x0130) {
      out.push('i');
      continue;
    }
    out.push(input[i] ?? '');
  }
  return out.join('');
}
