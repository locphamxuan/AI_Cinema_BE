import { BadRequestException } from '@nestjs/common';
import type { PaginateQuery } from '@nestarc/pagination';
import { isUUID } from 'class-validator';

/** Checks one raw value of a `filter.<column>` query parameter. */
export type FilterValueCheck = (value: string) => boolean;

/** A value of an enum, e.g. `oneOf(Object.values(ProjectStatus))`. */
export const oneOf =
  (values: readonly string[]): FilterValueCheck =>
  (value) =>
    values.includes(value);

export const anyUuid: FilterValueCheck = (value) => isUUID(value);

export const aBoolean: FilterValueCheck = (value) => value === 'true' || value === 'false';

/** The values of `$eq:a`, `$in:a,b`, `$not:a`…: what the paginator hands to the database as they are. */
function rawValues(raw: string): string[] {
  if (raw === '$null' || raw === '$not:null') return [];
  const colon = raw.indexOf(':');
  if (colon === -1) return [raw];
  return raw.slice(colon + 1).split(',');
}

/**
 * The paginator passes `filter.<column>` values straight to Prisma, so a value the column cannot hold (an unknown
 * enum value, a malformed UUID) would fail in the database as a 500. Refuses it here with a 400 instead.
 */
export function assertFilterValues(query: Pick<PaginateQuery, 'filter'>, checks: Record<string, FilterValueCheck>) {
  for (const [column, check] of Object.entries(checks)) {
    const raw = query.filter?.[column];
    if (raw === undefined) continue;
    const bad = (Array.isArray(raw) ? raw : [raw]).flatMap(rawValues).find((value) => !check(value));
    if (bad !== undefined) {
      throw new BadRequestException({
        message: `filter.${column} has an invalid value: ${bad}`,
        details: { reason: 'INVALID_FILTER', column, value: bad },
      });
    }
  }
}
