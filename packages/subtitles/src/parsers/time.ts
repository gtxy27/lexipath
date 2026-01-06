export function parseTimeToMs(input: string): number {
  const raw = input.trim();
  if (!raw) return 0;

  const msMatch = raw.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (msMatch?.[1]) {
    const value = Number.parseFloat(msMatch[1]);
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  const secMatch = raw.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secMatch?.[1]) {
    const value = Number.parseFloat(secMatch[1]);
    return Number.isFinite(value) ? Math.round(value * 1000) : 0;
  }

  const normalize = (value: string) => value.replace(',', '.');
  const parts = normalize(raw).split(':').map((p) => p.trim());

  if (parts.length === 3) {
    const hours = Number.parseInt(parts[0] || '0', 10);
    const minutes = Number.parseInt(parts[1] || '0', 10);
    const seconds = Number.parseFloat(parts[2] || '0');
    if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  if (parts.length === 2) {
    const minutes = Number.parseInt(parts[0] || '0', 10);
    const seconds = Number.parseFloat(parts[1] || '0');
    if (![minutes, seconds].every(Number.isFinite)) return 0;
    return Math.round((minutes * 60 + seconds) * 1000);
  }

  const seconds = Number.parseFloat(normalize(raw));
  if (Number.isFinite(seconds)) return Math.round(seconds * 1000);

  return 0;
}

