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
  const fees = { spendableTokens: jest.fn().mockResolvedValue(10) };
  const settings = { get: jest.fn().mockResolvedValue({ tokenRateVnd: 1000 }) };
  const service = new BriefService(
    prisma as never,
    storage as never,
    fees as never,
    settings as never,
    { briefFontPath: null } as never,
  );
  return { service, prisma };
}

describe('BriefService.prepare', () => {
  it('names the lead Creator as the only contact and leaves co-Creators out of the mail (BR-67)', async () => {
    const { service, prisma } = setup();

    const brief = await service.prepare('p1', { name: 'Studio X', contactName: null }, null, [], {
      senderId: 'c1',
      pendingLostTokens: 0,
    });

    expect(brief.creatorEmail).toBe(lead.email);
    expect(brief.text).toContain(`Đầu mối: ${lead.fullName} - ${lead.email}`);
    expect(brief.text).not.toMatch(/Đồng gửi|Phân công tập|CC/);
    const [query] = prisma.movieProject.findUniqueOrThrow.mock.calls[0] as unknown[];
    expect(JSON.stringify(query)).not.toContain('assignedCreator');
  });
});
