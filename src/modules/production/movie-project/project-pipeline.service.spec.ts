import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { ContractStatus, ScriptStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProjectPipelineService } from './project-pipeline.service';

jest.mock('@nestarc/pagination', () => ({ paginate: jest.fn() }));

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const QUERY = { path: '', page: 1, limit: 20 } as PaginateQuery;
const UPDATED_AT = new Date('2026-01-01T00:00:00Z');

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: 'ASSIGNED',
  updatedAt: UPDATED_AT,
  _count: { changeRequests: 1 },
  movie: {
    title: `Phim ${id}`,
    posterUrl: null,
    _count: { episodes: 1 },
    genres: [{ genre: { id: 'g1', name: 'Kinh dị' } }],
    episodes: [
      { id: 'e1', episodeNumber: 1, title: 'Tập 1', status: 'DRAFT', finalConfirmedAt: null, coinPrice: null },
    ],
  },
  script: null,
  contracts: [],
  ...overrides,
});

describe('ProjectPipelineService', () => {
  const paginateMock = paginate as jest.MockedFunction<typeof paginate>;
  const prisma = { movieProject: {}, auditLog: { groupBy: jest.fn() } };
  const access = { readableWhere: jest.fn() };
  const service = new ProjectPipelineService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.readableWhere.mockResolvedValue({ reviewerId: 'rev' });
    prisma.auditLog.groupBy.mockResolvedValue([]);
  });

  it('reads one page in a single paginated query, whatever its length, within what the caller may read', async () => {
    paginateMock.mockResolvedValueOnce({ data: [row('p1'), row('p2'), row('p3')], meta: { totalItems: 3 } } as never);

    const page = await service.list(QUERY, REVIEWER);

    expect(paginateMock).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.groupBy).toHaveBeenCalledTimes(1);
    expect(paginateMock).toHaveBeenCalledWith(
      QUERY,
      prisma.movieProject,
      expect.objectContaining({
        where: { AND: [{ reviewerId: 'rev' }, {}] },
        sortableColumns: ['status', 'createdAt', 'updatedAt'],
        filterableColumns: { status: ['$eq', '$in'], creatorId: ['$eq'] },
      }),
    );
    expect(page.meta).toEqual({ totalItems: 3 });
    expect(page.data).toHaveLength(3);
  });

  it('asks only for the open contract round, newest first', async () => {
    paginateMock.mockResolvedValueOnce({ data: [], meta: {} } as never);
    await service.list(QUERY, REVIEWER);
    const [, , options] = paginateMock.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { relations: { contracts: { where: { status: { in: ContractStatus[] } }; orderBy: unknown; take: number } } },
    ];
    expect(options.relations.contracts.where.status.in).toEqual([
      ContractStatus.SENT,
      ContractStatus.STUDIO_SIGNED,
      ContractStatus.ADMIN_COUNTERED,
    ]);
    expect(options.relations.contracts).toMatchObject({ orderBy: { round: 'desc' }, take: 1 });
  });

  it('searches on the movie title', async () => {
    paginateMock.mockResolvedValueOnce({ data: [], meta: {} } as never);
    await service.list({ ...QUERY, search: 'căn' }, REVIEWER);
    expect(paginateMock).toHaveBeenCalledWith(
      expect.anything(),
      prisma.movieProject,
      expect.objectContaining({
        where: { AND: [{ reviewerId: 'rev' }, { movie: { title: { contains: 'căn', mode: 'insensitive' } } }] },
      }),
    );
  });

  it('flattens each project with its script, episodes, contract and last activity', async () => {
    const logged = new Date('2026-02-01T00:00:00Z');
    const versionAt = new Date('2026-01-15T00:00:00Z');
    const contract = { id: 'c1', status: ContractStatus.STUDIO_SIGNED };
    paginateMock.mockResolvedValueOnce({
      data: [
        row('p1', {
          script: { status: ScriptStatus.SUBMITTED, currentVersion: 2, versions: [{ createdAt: versionAt }] },
          contracts: [contract],
        }),
        row('p2'),
      ],
      meta: {},
    } as never);
    prisma.auditLog.groupBy.mockResolvedValue([{ projectId: 'p1', _max: { createdAt: logged } }]);

    const { data } = await service.list(QUERY, REVIEWER);

    expect(data[0]).toMatchObject({
      id: 'p1',
      title: 'Phim p1',
      _count: { episodes: 1 },
      openChangeRequests: 1,
      lastActivityAt: logged,
      genres: [{ id: 'g1', name: 'Kinh dị' }],
      script: { status: ScriptStatus.SUBMITTED, currentVersion: 2, latestVersionAt: versionAt },
      episodes: [{ id: 'e1', episodeNumber: 1 }],
      contract,
    });
    expect(data[0]).not.toHaveProperty('movie');
    expect(data[0]).not.toHaveProperty('contracts');
    expect(data[1]).toMatchObject({ script: null, contract: null, lastActivityAt: UPDATED_AT });
  });

  it('copes with a script that has no version row', async () => {
    paginateMock.mockResolvedValueOnce({
      data: [row('p1', { script: { status: ScriptStatus.SUBMITTED, currentVersion: 1, versions: [] } })],
      meta: {},
    } as never);
    const { data } = await service.list(QUERY, REVIEWER);
    expect(data[0].script).toMatchObject({ latestVersionAt: null });
  });
});
