import { BriefService } from './brief.service';

const admin = { fullName: 'Admin Test', email: 'admin@gmail.com' };

function setup() {
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(admin) },
    movieProject: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ideaDescription: 'Ý tưởng',
        ideaFiles: [],
        movie: {
          title: 'Phim A',
          genres: [],
          episodes: [1, 2].map((episodeNumber) => ({
            episodeNumber,
            title: `Tập ${episodeNumber}`,
            targetDurationSeconds: 60,
            deliveryDeadline: null,
            season: { seasonNumber: 1 },
          })),
        },
      }),
    },
  };
  const storage = { putBuffer: jest.fn().mockResolvedValue(undefined) };
  const service = new BriefService(prisma as never, storage as never, { briefFontPath: null } as never);
  return { service, prisma };
}

describe('BriefService.prepare', () => {
  const context = { senderId: 'admin', offeredFeeVnd: 150_000_000 };

  it('names the Admin changing the studio in the PDF, and leaves the Creators out of the mail', async () => {
    const { service, prisma } = setup();
    const brief = await service.prepare('p1', { name: 'Studio X', contactName: null }, null, context);
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'admin' } }));
    expect(brief.lines.join(' ')).not.toMatch(/Đồng gửi|Phân công tập|CC|Creator/);
    const [query] = prisma.movieProject.findUniqueOrThrow.mock.calls[0] as unknown[];
    expect(JSON.stringify(query)).not.toContain('assignedCreator');
  });

  it('attaches the brief PDF alone: scripts and idea files stay on the platform', async () => {
    const { service } = setup();
    const brief = await service.prepare('p1', { name: 'Lumen', contactName: null }, null, context);
    expect(brief.attachments.map((a) => a.fileName)).toEqual(['brief-p1.pdf']);
  });

  it('offers the fee in VND as a fixed fee, never in Token', async () => {
    const { service } = setup();
    const brief = await service.prepare('p1', { name: 'Studio X', contactName: null }, null, context);
    const text = brief.lines.join(' ');
    expect(brief.offeredFeeVnd).toBe(150_000_000);
    expect(text).toContain('150.000.000 VND');
    expect(text).toContain('không chia doanh thu');
    expect(text).not.toMatch(/Token/);
  });
});
