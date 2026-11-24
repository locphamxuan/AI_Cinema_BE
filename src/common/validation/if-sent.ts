import { ValidateIf } from 'class-validator';

/**
 * Validates a PATCH field only when it is sent. Unlike IsOptional, an explicit null is validated (and refused), so
 * a column that cannot be cleared never reaches the database as null.
 */
export const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined);
