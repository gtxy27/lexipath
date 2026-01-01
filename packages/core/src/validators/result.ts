export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; fallback: T };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(fallback: T): Result<T> {
  return { ok: false, fallback };
}

