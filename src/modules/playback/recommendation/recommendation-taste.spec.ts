import {
  buildTaste,
  engagementOf,
  genreAffinity,
  reasonFor,
  type ProgressRow,
  type TasteMovie,
} from './recommendation-taste';

const film = (id: string, genre: string, country = 'VN'): TasteMovie => ({
  id,
  country,
  genres: [{ genre: { name: genre } }],
});
const row = (movie: TasteMovie, positionSeconds: number, completed = false, duration = 1000): ProgressRow => ({
  positionSeconds,
  durationSeconds: duration,
  completed,
  episode: { targetDurationSeconds: duration, movie },
});

describe('engagementOf (BR-68 viewing behavior)', () => {
  const m = film('m', 'Drama');
  it.each([
    ['FINISHED', [row(m, 1000, true), row(m, 950, true)]],
    ['ENGAGED', [row(m, 600)]],
    ['ENGAGED', [row(m, 100), row(m, 50)]],
    ['DROPPED', [row(m, 300)]],
    ['BOUNCED', [row(m, 60)]],
  ])('reads %s', (expected, rows) => {
    expect(engagementOf(rows)).toBe(expected);
  });

  it('falls back to the planned episode length when the player sent none', () => {
    expect(engagementOf([{ ...row(m, 900), durationSeconds: null }])).toBe('ENGAGED');
  });
});

describe('buildTaste', () => {
  const action = film('a', 'Action', 'KR');
  const horror = film('h', 'Horror', 'US');

  it('scores up what the member finishes and down what they leave at once', () => {
    const taste = buildTaste([], [row(action, 1000, true), row(horror, 30)]);
    expect(taste.behaviors.get('a')).toBe('FINISHED');
    expect(taste.behaviors.get('h')).toBe('BOUNCED');
    expect(genreAffinity(film('x', 'Action'), taste)).toBe(1);
    expect(genreAffinity(film('y', 'Horror'), taste)).toBeLessThan(0);
    expect(taste.seen).toEqual(new Set(['a', 'h']));
    expect(reasonFor(film('z', 'Action'), taste)).toBe('Hợp gu Action bạn hay xem hết');
  });

  it('lets a like outweigh a bounce on the same movie', () => {
    const taste = buildTaste([horror], [row(horror, 10)]);
    expect(taste.behaviors.get('h')).toBe('LIKED');
    expect(genreAffinity(film('y', 'Horror'), taste)).toBe(1);
  });

  it('gives no affinity before any positive signal', () => {
    const taste = buildTaste([], [row(horror, 10)]);
    expect(genreAffinity(film('y', 'Horror'), taste)).toBe(0);
    expect(reasonFor(film('y', 'Horror'), taste)).toBe('Đang thịnh hành trên AI Cinema');
  });
});
