import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { ProjectAccessService } from './project-access.service';

const project = { id: 'm1', reviewerId: 'r1', creatorId: 'lead', movie: { title: 'Phim' } };
const as = (id: string) => ({ id }) as AuthenticatedUser;

function setup(seats: string[] = ['helper']) {
  const prisma = {
    movieProject: { findUnique: jest.fn().mockResolvedValue(project) },
    episode: { findUnique: jest.fn() },
    projectCreatorAssignment: {
      count: jest.fn(({ where }: { where: { creatorId: string } }) => (seats.includes(where.creatorId) ? 1 : 0)),
    },
  };
  const accessControl = { permissionsOf: jest.fn().mockResolvedValue(new Set()) };
  return { service: new ProjectAccessService(prisma as never, accessControl as never), prisma };
}

describe('ProjectAccessService', () => {
  it('lets only the lead Creator speak to the studio', async () => {
    const { service } = setup();

    await expect(service.project('m1', as('lead'), 'lead')).resolves.toBe(project);
    await expect(service.project('m1', as('helper'), 'lead')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.project('m1', as('r1'), 'lead')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still lets another Creator of the team act as a Creator', async () => {
    const { service } = setup();
    await expect(service.project('m1', as('helper'), 'creator')).resolves.toBe(project);
  });

  it('keeps an episode for the Creator it was given to, and one given to nobody for the lead', async () => {
    const { service, prisma } = setup();
    const episode = (assignedCreatorId: string | null) => ({
      id: 'e1',
      assignedCreatorId,
      movie: { id: 'm1', project },
    });

    prisma.episode.findUnique.mockResolvedValue(episode('helper'));
    await expect(service.episode('e1', as('helper'), 'creator')).resolves.toBeTruthy();
    await expect(service.episode('e1', as('lead'), 'creator')).resolves.toBeTruthy();

    prisma.episode.findUnique.mockResolvedValue(episode(null));
    await expect(service.episode('e1', as('lead'), 'creator')).resolves.toBeTruthy();
    await expect(service.episode('e1', as('helper'), 'creator')).rejects.toThrow('belongs to the lead Creator');
    await expect(service.episode('e1', as('helper'), 'read')).resolves.toBeTruthy();
  });
});
