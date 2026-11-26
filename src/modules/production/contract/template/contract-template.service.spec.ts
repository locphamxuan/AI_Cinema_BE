import { NotFoundException } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { ContractHandoffService } from '../contract-handoff.service';
import { BLANK } from './contract-clauses';
import { PLATFORM, STUDIO } from './template.fixtures';
import * as pdf from './contract-template-pdf';
import { vnDay } from './contract-template-pdf';
import { ContractTemplateService, longVnDay } from './contract-template.service';

const SOURCE = {
  id: '9f2b4c6e-0000-4000-8000-000000000001',
  round: 2,
  projectId: 'p1',
  handoffId: null,
  costVnd: null as bigint | null,
  status: 'SENT',
  createdAt: new Date('2026-11-16T18:30:00.000Z'),
  studio: STUDIO,
  project: {
    movie: {
      title: 'Giấc Mơ Số',
      ageRating: 'T13' as string | null,
      genres: [{ genre: { name: 'Tâm lý' } }, { genre: { name: 'Viễn tưởng' } }],
      episodes: [
        {
          episodeNumber: 1,
          title: 'Khởi động',
          targetDurationSeconds: 725,
          deliveryDeadline: new Date('2026-11-25T00:00:00Z') as Date | null,
        },
        { episodeNumber: 2, title: 'Lỗi', targetDurationSeconds: 600, deliveryDeadline: null },
      ],
    },
  },
};

describe('ContractTemplateService', () => {
  const prisma = { contract: { findFirst: jest.fn() } };
  const access = { project: jest.fn() };
  const handoffs = { budgetOf: jest.fn() };
  const settings = { get: jest.fn() };
  const service = new ContractTemplateService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    handoffs as unknown as ContractHandoffService,
    settings as unknown as PlatformSettingService,
    { briefFontPath: null } as AppConfig,
  );
  const render = jest.spyOn(pdf, 'renderContractPdf');
  const draftOf = (call = 0) => render.mock.calls[call][0];
  const optionsOf = (call = 0) => render.mock.calls[call][1];

  beforeEach(() => {
    jest.clearAllMocks();
    render.mockResolvedValue(Buffer.from('%PDF-1.7'));
    handoffs.budgetOf.mockResolvedValue(200_000_000);
    settings.get.mockResolvedValue({ ...PLATFORM, contractPlace: 'Thành phố Hồ Chí Minh' });
    prisma.contract.findFirst.mockResolvedValue(SOURCE);
  });

  it('formats contract dates in Vietnam time', () => {
    expect(vnDay(SOURCE.createdAt)).toBe('17/11/2026');
    expect(longVnDay(SOURCE.createdAt)).toBe('17 tháng 11 năm 2026');
  });

  it('fills the contract with the project, both parties and the budget ceiling as its value', async () => {
    const user = { id: 'rev', role: 'REVIEWER' } as never;

    const file = await service.forStaff(SOURCE.id, user);

    expect(prisma.contract.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SOURCE.id } }));
    expect(access.project).toHaveBeenCalledWith('p1', user, 'read');
    expect(handoffs.budgetOf).toHaveBeenCalledWith(prisma, SOURCE);
    expect(draftOf()).toMatchObject({
      contractNo: 'AIC-2026-9F2B4C6E-R2',
      day: '17 tháng 11 năm 2026',
      place: 'Thành phố Hồ Chí Minh',
      genre: 'Tâm lý, Viễn tưởng',
      ageRating: 'T13',
      costVnd: 200_000_000,
      budgetVnd: 200_000_000,
      episodes: [
        { number: 1, title: 'Khởi động', minutes: 12, dueDate: '25/11/2026' },
        { number: 2, title: 'Lỗi', minutes: 10, dueDate: '-' },
      ],
    });
    expect(draftOf().partyA.name).toBe('Công ty TNHH AI Cinema');
    expect(draftOf().partyB).toMatchObject({ name: 'Lumen Studio', representative: 'Nguyễn Thị Lan' });
    expect(optionsOf()).toMatchObject({ keywords: `aicinema-project:p1 aicinema-contract:${SOURCE.id}`, stamps: [] });
    expect(file.getHeaders()).toMatchObject({
      type: 'application/pdf',
      length: 8,
      disposition: 'attachment; filename="hop-dong-chua-ky-AIC-2026-9F2B4C6E-R2.pdf"',
    });
  });

  it('keeps the cost a side proposed and names what is not known yet', async () => {
    const movie = { ...SOURCE.project.movie, ageRating: null, genres: [] };
    prisma.contract.findFirst.mockResolvedValue({ ...SOURCE, costVnd: 170_000_000n, project: { movie } });
    settings.get.mockResolvedValue({ ...PLATFORM, contractPlace: null });

    await service.forStudio(SOURCE.id, 's1');

    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SOURCE.id, studioId: 's1' } }),
    );
    expect(draftOf()).toMatchObject({
      costVnd: 170_000_000,
      genre: 'chưa phân loại',
      ageRating: 'chưa phân loại',
      place: BLANK,
    });
  });

  it('renders a signed copy through the signing transaction with the given signatures drawn in', async () => {
    const tx = { contract: { findFirst: jest.fn().mockResolvedValue(SOURCE) } };
    const stamps = [
      {
        side: 'STUDIO' as const,
        image: Buffer.from('png'),
        signerName: 'Lan',
        signerTitle: 'GĐ',
        signedAt: new Date(),
      },
    ];

    await expect(service.signedCopy(tx as never, SOURCE.id, stamps)).resolves.toEqual(Buffer.from('%PDF-1.7'));

    expect(tx.contract.findFirst).toHaveBeenCalled();
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    expect(handoffs.budgetOf).toHaveBeenCalledWith(tx, SOURCE);
    expect(optionsOf().stamps).toBe(stamps);
  });

  it('names the signer of each side as the contract prints it', async () => {
    await expect(service.signer(prisma as never, SOURCE.id, 'ADMIN')).resolves.toEqual({
      name: 'Nguyễn Văn An',
      title: 'Giám đốc',
    });
    await expect(service.signer(prisma as never, SOURCE.id, 'STUDIO')).resolves.toEqual({
      name: 'Nguyễn Thị Lan',
      title: BLANK,
    });
  });

  it('answers 404 for an unknown round or a round of another studio', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.forStaff('x', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forStudio('x', 's2')).rejects.toBeInstanceOf(NotFoundException);
    expect(render).not.toHaveBeenCalled();
  });
});
