import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { StudioAccountService } from 'src/modules/production/studio/studio-account.service';
import { StudioProfileService } from './studio-profile.service';

const STUDIO = {
  id: 's1',
  name: 'Lumen Studio',
  email: 'hopdong@lumen.example',
  contactName: 'Nguyễn Thị Lan',
  phone: null,
  address: null,
  taxCode: null,
  bankAccount: null,
  bankName: null,
  representativeTitle: null,
};

const PROFILE = {
  address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
  taxCode: '0312345678-001',
  bankAccount: '0123456789',
  bankName: 'ACB',
  representativeTitle: 'Giám đốc',
};

describe('StudioProfileService', () => {
  const prisma = { studio: { findUniqueOrThrow: jest.fn(), update: jest.fn() } };
  const accounts = { studioOf: jest.fn() };
  const service = new StudioProfileService(
    prisma as unknown as PrismaService,
    accounts as unknown as StudioAccountService,
  );
  const user = { id: 'u1', role: 'STUDIO' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.studioOf.mockResolvedValue('s1');
  });

  it('shows the studio its own profile with what still blocks signing', async () => {
    prisma.studio.findUniqueOrThrow.mockResolvedValue(STUDIO);

    const profile = await service.get(user);

    expect(prisma.studio.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
    expect(profile).toMatchObject({
      name: 'Lumen Studio',
      complete: false,
      missing: ['address', 'taxCode', 'bankAccount', 'bankName', 'representativeTitle'],
    });
  });

  it('saves only the legal fields, never the name, email or representative the Admin keeps', async () => {
    prisma.studio.update.mockResolvedValue({ ...STUDIO, ...PROFILE });

    const saved = await service.update(user, { ...PROFILE, name: 'Đổi tên', email: 'x@y.z' } as never);

    expect(prisma.studio.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' }, data: PROFILE }));
    expect(saved).toMatchObject({ complete: true, missing: [] });
  });

  it('reaches no profile for an account that is not a studio', async () => {
    accounts.studioOf.mockRejectedValue(new ForbiddenException());
    await expect(service.update(user, PROFILE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.studio.update).not.toHaveBeenCalled();
  });
});
