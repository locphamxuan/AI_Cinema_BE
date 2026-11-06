import { BriefService } from './brief.service';

const lead = { fullName: 'Creator Test', email: 'creator@gmail.com' };

function setup() {
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(lead) },
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
  it('names the lead Creator as the only contact and leaves co-Creators out of the mail (BR-67)', async () => {
    const { service, prisma } = setup();

    const brief = await service.prepare('p1', { name: 'Studio X', contactName: null }, null, [], {
      senderId: 'c1',
      offeredFeeVnd: 150_000_000,
    });

    expect(brief.creatorEmail).toBe(lead.email);
    expect(brief.text).toContain(`Đầu mối: ${lead.fullName} - ${lead.email}`);
    expect(brief.text).not.toMatch(/Đồng gửi|Phân công tập|CC/);
    const [query] = prisma.movieProject.findUniqueOrThrow.mock.calls[0] as unknown[];
    expect(JSON.stringify(query)).not.toContain('assignedCreator');
  });

  it('offers the fee in VND as a fixed fee, never in Token', async () => {
    const { service } = setup();

    const brief = await service.prepare('p1', { name: 'Studio X', contactName: null }, null, [], {
      senderId: 'c1',
      offeredFeeVnd: 150_000_000,
    });

    expect(brief.offeredFeeVnd).toBe(150_000_000);
    expect(brief.text).toContain('150.000.000 VND');
    expect(brief.text).toContain('không chia doanh thu');
    expect(brief.text).not.toMatch(/Token/);
  });
});
