import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewEpisodeDto } from './create-movie-project.request.dto';
import { ReasonRequestDto, UpdateEpisodeRequestDto, UpdateSeasonRequestDto } from './project-actions.request.dto';
import { UpdateMovieProjectRequestDto } from './update-movie-project.request.dto';

async function refused<T extends object>(cls: new () => T, body: object) {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('movie-project requests', () => {
  it('refuses a blank reason (cancel, Final Film rejection)', async () => {
    expect(await refused(ReasonRequestDto, { reason: '      ' })).toEqual(['reason']);
    expect(await refused(ReasonRequestDto, { reason: '  Studio đóng cửa  ' })).toEqual([]);
  });

  it('takes calendar days only for deadlines and release dates (BR-38, BR-60)', async () => {
    const episode = { title: 'Tập 1', targetDurationSeconds: 900 };
    expect(await refused(NewEpisodeDto, { ...episode, deliveryDeadline: '2099-01-10' })).toEqual([]);
    expect(await refused(NewEpisodeDto, { ...episode, deliveryDeadline: '2099-01-10T23:00:00Z' })).toEqual([
      'deliveryDeadline',
    ]);
    expect(await refused(NewEpisodeDto, { ...episode, deliveryDeadline: '2099-02-30' })).toEqual(['deliveryDeadline']);
    expect(await refused(UpdateSeasonRequestDto, { releaseStartDate: '2099-01-01T00:00:00+07:00' })).toEqual([
      'releaseStartDate',
    ]);
    expect(await refused(UpdateSeasonRequestDto, { releaseStartDate: null, title: null })).toEqual([]);
  });

  it('never clears an episode title, length or deadline with null, but clears the expected release', async () => {
    expect(
      await refused(UpdateEpisodeRequestDto, { title: null, targetDurationSeconds: null, deliveryDeadline: null }),
    ).toEqual(['title', 'targetDurationSeconds', 'deliveryDeadline']);
    expect(await refused(UpdateEpisodeRequestDto, { title: '   ' })).toEqual(['title']);
    expect(await refused(UpdateEpisodeRequestDto, { expectedReleaseDate: null, synopsis: null })).toEqual([]);
  });

  it('never clears the project title, idea, genres, language or studio with null', async () => {
    const body = { title: null, ideaDescription: null, genreIds: null, defaultLanguage: null, studioId: null };
    expect(await refused(UpdateMovieProjectRequestDto, body)).toEqual(Object.keys(body));
    expect(await refused(UpdateMovieProjectRequestDto, { synopsis: null, ageRating: null })).toEqual([]);
  });

  it('trims genre names, so a blank one is refused', async () => {
    expect(await refused(UpdateMovieProjectRequestDto, { genreNames: ['  '] })).toEqual(['genreNames']);
    const dto = plainToInstance(UpdateMovieProjectRequestDto, { genreNames: ['  Hậu tận thế '] });
    expect(dto.genreNames).toEqual(['Hậu tận thế']);
  });
});
