import { NotFoundException } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { ContractHandoffService } from '../contract-handoff.service';
import * as pdf from './contract-template-pdf';
import { ContractTemplateService, longVnDay, vnDay } from './contract-template.service';

const SOURCE = {
  id: '9f2b4c6e-0000-4000-8000-000000000001',
  round: 2,
  projectId: 'p1',
  handoffId: null,
  costVnd: null as bigint | null,
  status: 'SENT',
  createdAt: new Date('2026-11-16T18:30:00.000Z'),
  studio: { name: 'Lumen', email: 'studio@lumen.example', phone: null, contactName: 'Bình' },
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
  const prisma = { contract: { findUnique: jest.fn(), findFirst: jest.fn() } };
  const access = { project: jest.fn() };
  const handoffs = { budgetOf: jest.fn() };
  const service = new ContractTemplateService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    handoffs as unknown as ContractHandoffService,
    { briefFontPath: null } as AppConfig,
  );
  const render = jest.spyOn(pdf, 'renderContractPdf');

  beforeEach(() => {
    jest.clearAllMocks();
    render.mockResolvedValue(Buffer.from('%PDF-1.7'));
    handoffs.budgetOf.mockResolvedValue(200_000_000);
  });

  it('formats contract dates in Vietnam time', () => {
    expect(vnDay(SOURCE.createdAt)).toBe('17/11/2026');
    expect(longVnDay(SOURCE.createdAt)).toBe('17 tháng 11 năm 2026');
  });

  it('fills the template with the project, the studio and the budget for the project team', async () => {
    prisma.contract.findUnique.mockResolvedValue(SOURCE);
    const user = { id: 'rev', role: 'REVIEWER' } as never;

    const file = await service.forStaff(SOURCE.id, user);

    expect(access.project).toHaveBeenCalledWith('p1', user, 'read');
    expect(handoffs.budgetOf).toHaveBeenCalledWith(prisma, SOURCE);
    const [draft, options] = render.mock.calls[0];
    expect(draft).toMatchObject({
      contractNo: 'AIC-2026-9F2B4C6E-R2',
      day: '17 tháng 11 năm 2026',
      genre: 'Tâm lý, Viễn tưởng',
      ageRating: 'T13',
      costVnd: null,
      budgetVnd: 200_000_000,
      episodes: [
        { number: 1, title: 'Khởi động', minutes: 12, dueDate: '25/11/2026' },
        { number: 2, title: 'Lỗi', minutes: 10, dueDate: '-' },
      ],
    });
    expect(draft.partyB).toMatchObject({ name: 'Lumen', representative: 'Bình' });
    expect(options.mark).toBeUndefined();
    expect(file.getHeaders()).toMatchObject({ type: 'application/pdf', length: 8 });
  });

  it('keeps the cost of a priced round and names unknown labels', async () => {
    const movie = { ...SOURCE.project.movie, ageRating: null, genres: [] };
    prisma.contract.findFirst.mockResolvedValue({ ...SOURCE, costVnd: 170_000_000n, project: { movie } });

    await service.forStudio(SOURCE.id, 's1');

    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SOURCE.id, studioId: 's1' } }),
    );
    expect(render.mock.calls[0][0]).toMatchObject({
      costVnd: 170_000_000,
      genre: 'chưa phân loại',
      ageRating: 'chưa phân loại',
    });
  });

  it('answers 404 for an unknown round or a round of another studio', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.forStaff('x', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forStudio('x', 's2')).rejects.toBeInstanceOf(NotFoundException);
    expect(render).not.toHaveBeenCalled();
  });
});
