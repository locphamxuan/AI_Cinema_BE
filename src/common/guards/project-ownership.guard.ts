import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/prisma/prisma.service';

type ProjectResolver = (prisma: PrismaService, id: string) => Promise<string | null | undefined>;

const planProject = (prisma: PrismaService, planId: string) =>
  prisma.productionPlan.findUnique({ where: { id: planId }, select: { productionProjectId: true } });

// Route params that identify something inside a production project, in lookup order.
const RESOLVERS: [param: string, resolve: ProjectResolver][] = [
  ['projectId', (_prisma, id) => Promise.resolve(id)],
  ['planId', async (prisma, id) => (await planProject(prisma, id))?.productionProjectId],
  [
    'sceneId',
    async (prisma, id) =>
      (
        await prisma.scene.findUnique({
          where: { id },
          select: { productionPlan: { select: { productionProjectId: true } } },
        })
      )?.productionPlan.productionProjectId,
  ],
  [
    'jobId',
    async (prisma, id) =>
      (
        await prisma.generationJob.findUnique({
          where: { id },
          select: { productionPlan: { select: { productionProjectId: true } } },
        })
      )?.productionPlan.productionProjectId,
  ],
  [
    'packageId',
    async (prisma, id) =>
      (
        await prisma.episodePackage.findUnique({
          where: { id },
          select: { productionPlan: { select: { productionProjectId: true } } },
        })
      )?.productionPlan.productionProjectId,
  ],
  [
    'milestoneId',
    async (prisma, id) =>
      (await prisma.milestone.findUnique({ where: { id }, select: { productionProjectId: true } }))
        ?.productionProjectId,
  ],
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Content Creator may only read or change the projects assigned to them.
 * Reviewers and admins work across all projects, so they are not restricted here.
 * Unknown ids fall through so the handler can answer 404/400 itself.
 */
@Injectable()
export class ProjectOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; params?: Record<string, string> }>();
    const { user, params = {} } = request;
    if (user?.role !== UserRole.CONTENT_CREATOR) return true;

    const match = RESOLVERS.find(([param]) => UUID.test(params[param] ?? ''));
    if (!match) return true;

    const [param, resolve] = match;
    const projectId = await resolve(this.prisma, params[param]);
    if (!projectId) return true;

    const project = await this.prisma.productionProject.findUnique({
      where: { id: projectId },
      select: { assignedCreatorId: true },
    });
    if (project && project.assignedCreatorId !== user.id) {
      throw new ForbiddenException('This production project is not assigned to you');
    }
    return true;
  }
}
