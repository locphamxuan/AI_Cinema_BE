import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectOwnershipGuard } from './project-ownership.guard';

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';

const contextFor = (role: UserRole, params: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { id: CREATOR_ID, email: 'c@x', role }, params }) }),
  }) as unknown as ExecutionContext;

describe('ProjectOwnershipGuard', () => {
  const prisma = {
    productionProject: { findUnique: jest.fn() },
    productionPlan: { findUnique: jest.fn() },
  };
  const guard = new ProjectOwnershipGuard(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('lets a creator act on the project assigned to them', async () => {
    prisma.productionProject.findUnique.mockResolvedValue({ assignedCreatorId: CREATOR_ID });

    await expect(guard.canActivate(contextFor(UserRole.CONTENT_CREATOR, { projectId: PROJECT_ID }))).resolves.toBe(
      true,
    );
  });

  it("blocks a creator from another creator's project, resolved through the plan", async () => {
    prisma.productionPlan.findUnique.mockResolvedValue({ productionProjectId: PROJECT_ID });
    prisma.productionProject.findUnique.mockResolvedValue({ assignedCreatorId: 'someone-else' });

    await expect(guard.canActivate(contextFor(UserRole.CONTENT_CREATOR, { planId: PLAN_ID }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('does not restrict reviewers', async () => {
    await expect(guard.canActivate(contextFor(UserRole.CONTENT_REVIEWER, { projectId: PROJECT_ID }))).resolves.toBe(
      true,
    );
    expect(prisma.productionProject.findUnique).not.toHaveBeenCalled();
  });

  it('leaves unknown ids to the handler', async () => {
    prisma.productionPlan.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor(UserRole.CONTENT_CREATOR, { planId: PLAN_ID }))).resolves.toBe(true);
  });
});
