import { Transform } from 'class-transformer';

/** Trims a string before it is validated, so "   " fails MinLength / IsNotEmpty like an empty value. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and lower-cases an email, the way accounts are stored. */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
