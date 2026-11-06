import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDivisibleBy, IsInt, Max, Min } from 'class-validator';

/** Largest VND amount accepted anywhere (100 billion): far below Number.MAX_SAFE_INTEGER. */
export const MAX_VND = 100_000_000_000;

/**
 * A VND amount in whole thousands (BR-45). `min` defaults to 1,000; a correction passes -MAX_VND.
 * Numbers sent as multipart text are converted first.
 */
export function IsVnd(min = 1000) {
  return applyDecorators(
    Type(() => Number),
    IsInt(),
    IsDivisibleBy(1000, { message: '$property must be a multiple of 1,000 VND' }),
    Min(min),
    Max(MAX_VND),
  );
}
