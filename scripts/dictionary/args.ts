export type ArgValue = string | boolean;

export function parseArgs(argv: string[]): Record<string, ArgValue> {
  const result: Record<string, ArgValue> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? "";
    if (!raw.startsWith("--")) continue;

    const eqIndex = raw.indexOf("=");
    const key = (eqIndex >= 0 ? raw.slice(2, eqIndex) : raw.slice(2)).trim();
    if (!key) continue;

    if (eqIndex >= 0) {
      result[key] = raw.slice(eqIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
      continue;
    }

    result[key] = true;
  }
  return result;
}

export function getStringArg(args: Record<string, ArgValue>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function getBooleanArg(args: Record<string, ArgValue>, key: string): boolean {
  const value = args[key];
  return value === true || value === "true";
}

export function getNumberArg(args: Record<string, ArgValue>, key: string): number | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

