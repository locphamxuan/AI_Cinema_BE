import { briefTeam, briefTeamLines } from './brief-team';

const lead = { id: 'c1', fullName: 'Creator Test', email: 'creator@gmail.com' };
const helper = { id: 'c2', fullName: 'Creator Tester', email: 'creatorr@gmail.com' };

describe('briefTeam', () => {
  const episodes = [
    { episodeNumber: 1, seasonNumber: 1, assignedCreator: null },
    { episodeNumber: 2, seasonNumber: 1, assignedCreator: helper },
    { episodeNumber: 3, seasonNumber: 1, assignedCreator: helper },
  ];

  it('gives an episode nobody holds to the lead and CCs every other Creator once', () => {
    const team = briefTeam(episodes, lead, lead.id);

    expect(team.owners.map(({ episodeNumber, owner }) => [episodeNumber, owner.id])).toEqual([
      [1, 'c1'],
      [2, 'c2'],
      [3, 'c2'],
    ]);
    expect(team.coSenders).toEqual([helper]);
  });

  it('never CCs the Creator who sends the brief', () => {
    expect(briefTeam(episodes, lead, helper.id).coSenders).toEqual([lead]);
  });

  it('writes the "Đồng gửi" line and one line per episode for the Studio Web to read', () => {
    expect(briefTeamLines(briefTeam(episodes, lead, lead.id))).toEqual([
      'Đồng gửi: Creator Tester <creatorr@gmail.com>',
      'Phân công tập:',
      '- Tập 1: Creator Test - creator@gmail.com',
      '- Tập 2: Creator Tester - creatorr@gmail.com',
      '- Tập 3: Creator Tester - creatorr@gmail.com',
      'Khi gửi phim, vui lòng CC những người ở dòng "Đồng gửi" và ghi rõ tập nào của ai.',
    ]);
  });

  it('leaves out "Đồng gửi" when the sender holds every episode', () => {
    const lines = briefTeamLines(briefTeam([episodes[0]], lead, lead.id));
    expect(lines).toEqual(['Phân công tập:', '- Tập 1: Creator Test - creator@gmail.com']);
  });

  it('writes nothing when no episode has an owner', () => {
    expect(briefTeamLines(briefTeam([episodes[0]], null, 'x'))).toEqual([]);
  });
});
