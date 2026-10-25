import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Studio } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { CreateStudioRequestDto, UpdateStudioRequestDto } from './dto/studio.request.dto';

/** The catalog of partner studios the Reviewer keeps (BR-59). A studio has no account (BR-15). */
@Injectable()
export class StudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  list(active?: boolean) {
    return this.prisma.studio.findMany({
      where: active === undefined ? {} : { isActive: active },
      orderBy: { name: 'asc' },
      include: { _count: { select: { movies: true, handoffs: true } } },
    });
  }

  async detail(studioId: string) {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      include: { _count: { select: { movies: true, handoffs: true } } },
    });
    if (!studio) throw new NotFoundException('Studio not found');
    return studio;
  }

  async create(dto: CreateStudioRequestDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const studio = await this.guardEmail(() => tx.studio.create({ data: { ...dto, createdById: user.id } }));
      await this.record(CONTENT_EVENT.STUDIO_CREATED, studio, user, tx);
      return studio;
    });
  }

  async update(studioId: string, dto: UpdateStudioRequestDto, user: AuthenticatedUser) {
    await this.detail(studioId);
    return this.prisma.$transaction(async (tx) => {
      const studio = await this.guardEmail(() => tx.studio.update({ where: { id: studioId }, data: dto }));
      await this.record(CONTENT_EVENT.STUDIO_UPDATED, studio, user, tx, { fields: Object.keys(dto) });
      return studio;
    });
  }

  /** Only a studio never used can go; one that took a project is deactivated instead (BR-59). */
  async remove(studioId: string, user: AuthenticatedUser): Promise<void> {
    const studio = await this.detail(studioId);
    if (studio._count.movies || studio._count.handoffs) {
      throw new ConflictException('The studio took a project; deactivate it instead of deleting it');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.studio.delete({ where: { id: studioId } });
      await this.record(CONTENT_EVENT.STUDIO_DELETED, studio, user, tx);
    });
  }

  /**
   * The studio of a hand-off: found by the typed email (created on the spot when new), else by id, else the
   * project's current one. The studio is always usable (active) when this returns.
   */
  async resolve(
    choice: { studioId?: string; studioName?: string; studioEmail?: string; studioPhone?: string },
    fallbackId: string | null,
    user: AuthenticatedUser,
  ): Promise<Studio> {
    if (choice.studioEmail) {
      const known = await this.prisma.studio.findUnique({ where: { email: choice.studioEmail } });
      if (known) return this.assertUsable(known.id);
      if (!choice.studioName) throw new BadRequestException('Type the name of the studio (studioName)');
      return this.create({ name: choice.studioName, email: choice.studioEmail, phone: choice.studioPhone }, user);
    }
    const id = choice.studioId ?? fallbackId;
    if (!id) throw new ConflictException('Type the name and email of the studio to hand the project off to');
    return this.assertUsable(id);
  }

  /** The studio a project or hand-off may be given: it must exist and still be active. */
  async assertUsable(studioId: string, tx?: PrismaTx): Promise<Studio> {
    const studio = await (tx ?? this.prisma).studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new BadRequestException('The studio does not exist');
    if (!studio.isActive) throw new ConflictException(`Studio "${studio.name}" is deactivated`);
    return studio;
  }

  private async guardEmail<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A studio with this email already exists');
      }
      throw error;
    }
  }

  private record(
    action: (typeof CONTENT_EVENT)[keyof typeof CONTENT_EVENT],
    studio: Pick<Studio, 'id' | 'name' | 'email'>,
    user: AuthenticatedUser,
    tx: PrismaTx,
    extra: Record<string, unknown> = {},
  ) {
    return this.auditLog.record(
      {
        action,
        entityType: 'Studio',
        entityId: studio.id,
        movieId: null,
        actorId: user.id,
        payload: { name: studio.name, email: studio.email, ...extra },
      },
      tx,
    );
  }
}
