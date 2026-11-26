import { BadRequestException } from '@nestjs/common';
import { aBoolean, anyUuid, assertFilterValues, oneOf } from './filter-values';

const UUID = '8c1b2f3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('assertFilterValues', () => {
  const checks = { status: oneOf(['OPEN', 'DONE']), ownerId: anyUuid, isActive: aBoolean };

  it('lets valid values, $null and missing filters through', () => {
    expect(() => assertFilterValues({}, checks)).not.toThrow();
    expect(() =>
      assertFilterValues(
        { filter: { status: '$in:OPEN,DONE', ownerId: `$eq:${UUID}`, isActive: '$eq:false', other: '$eq:x' } },
        checks,
      ),
    ).not.toThrow();
    expect(() => assertFilterValues({ filter: { ownerId: '$null', status: ['$eq:OPEN'] } }, checks)).not.toThrow();
  });

  it('refuses an unknown enum value, a malformed id or a non-boolean with a stable reason', () => {
    const filters: Record<string, string>[] = [{ status: '$eq:LOST' }, { ownerId: '$eq:abc' }, { isActive: '$eq:yes' }];
    for (const filter of filters) {
      let error: unknown;
      try {
        assertFilterValues({ filter }, checks);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        details: { reason: 'INVALID_FILTER', column: Object.keys(filter)[0] },
      });
    }
  });
});
