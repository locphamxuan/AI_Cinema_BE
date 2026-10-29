import { Transform } from 'class-transformer';

/** Trims a string before it is validated, so "   " fails MinLength / IsNotEmpty like an empty value. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and lower-cases an email, the way accounts are stored. */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** An empty query filter (`?status=`) means "no filter", not an invalid value. */
export const EmptyAsUnset = () => Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value));
