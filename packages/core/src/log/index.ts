export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = Readonly<{
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}>;

function prefix(scope: string): string {
  return scope ? `[LexiPath:${scope}]` : '[LexiPath]';
}

export function createLogger(scope: string): Logger {
  const tag = prefix(scope);
  return Object.freeze({
    debug: (...args: unknown[]) => console.debug(tag, ...args),
    info: (...args: unknown[]) => console.info(tag, ...args),
    warn: (...args: unknown[]) => console.warn(tag, ...args),
    error: (...args: unknown[]) => console.error(tag, ...args),
  });
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error';
  if (typeof error === 'string') return error || 'Unknown error';
  if (typeof error === 'number' || typeof error === 'bigint' || typeof error === 'boolean') return String(error);

  try {
    return JSON.stringify(error);
  } catch (stringifyError: unknown) {
    return 'Unknown error';
  }
}
