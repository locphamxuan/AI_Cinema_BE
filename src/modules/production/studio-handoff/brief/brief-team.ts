export interface BriefPerson {
  id: string;
  fullName: string;
  email: string;
}

export interface BriefTeamEpisode {
  episodeNumber: number;
  seasonNumber: number;
  assignedCreator: BriefPerson | null;
}

interface EpisodeOwner {
  episodeNumber: number;
  seasonNumber: number;
  owner: BriefPerson;
}

export interface BriefTeam {
  /** Who answers for each episode: the Creator it was given to, else the lead (BR-13). */
  owners: EpisodeOwner[];
  /** The other Creators of the scope, CC'd by the studio when it mails the film back. */
  coSenders: BriefPerson[];
}

/** Who the studio talks to for the episodes of one brief; the sender is the contact and never CC'd. */
export function briefTeam(episodes: BriefTeamEpisode[], lead: BriefPerson | null, senderId: string): BriefTeam {
  const owners = episodes.flatMap((episode) => {
    const owner = episode.assignedCreator ?? lead;
    return owner ? [{ episodeNumber: episode.episodeNumber, seasonNumber: episode.seasonNumber, owner }] : [];
  });
  const coSenders = owners
    .map(({ owner }) => owner)
    .filter((person, i, all) => person.id !== senderId && all.findIndex((other) => other.id === person.id) === i);
  return { owners, coSenders };
}

export const personLine = (person: Pick<BriefPerson, 'fullName' | 'email'>) => `${person.fullName} <${person.email}>`;

/** The lines the Studio Web reads off the brief mail: "Đồng gửi: …" and one "- Tập N: name - email" per episode. */
export function briefTeamLines(team: BriefTeam): string[] {
  if (!team.owners.length) return [];
  return [
    ...(team.coSenders.length ? [`Đồng gửi: ${team.coSenders.map(personLine).join(', ')}`] : []),
    'Phân công tập:',
    ...team.owners.map(({ episodeNumber, owner }) => `- Tập ${episodeNumber}: ${owner.fullName} - ${owner.email}`),
    ...(team.coSenders.length
      ? ['Khi gửi phim, vui lòng CC những người ở dòng "Đồng gửi" và ghi rõ tập nào của ai.']
      : []),
  ];
}
