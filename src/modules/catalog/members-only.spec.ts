import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { assertMember } from './members-only';

describe('assertMember', () => {
  it('lets a member like or save', () => {
    expect(() => assertMember({ role: UserRole.MEMBER })).not.toThrow();
  });

  it.each([UserRole.ADMIN, UserRole.STAFF, UserRole.STUDIO, UserRole.CONTENT_REVIEWER])(
    'refuses a %s account with MEMBERS_ONLY so staff never move the ranking',
    (role) => {
      let error: unknown;
      try {
        assertMember({ role });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ details: { reason: 'MEMBERS_ONLY' } });
    },
  );
});
