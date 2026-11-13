export type Env = Record<string, string | undefined>;

/**
 * Reads and validates one environment variable at a time, collecting every problem so a bad
 * .env reports all of its errors at once instead of one per restart (see app-config.ts).
 */
export class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: Env) {}

  string(key: string, fallback?: string): string {
    const value = this.env[key]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    this.errors.push(`${key} is required`);
    return '';
  }

  optional(key: string): string | undefined {
    return this.env[key]?.trim() || undefined;
  }

  int(key: string, fallback: number, min = 0): number {
    const raw = this.optional(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      this.errors.push(`${key} must be an integer >= ${min} (got "${raw}")`);
      return fallback;
    }
    return value;
  }

  float(key: string, fallback: number, min = -Infinity): number {
    const raw = this.optional(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      this.errors.push(`${key} must be a finite number >= ${min} (got "${raw}")`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.optional(key)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    this.errors.push(`${key} must be true or false (got "${raw}")`);
    return fallback;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const raw = this.optional(key);
    if (raw === undefined) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    this.errors.push(`${key} must be one of ${allowed.join(', ')} (got "${raw}")`);
    return fallback;
  }
}
