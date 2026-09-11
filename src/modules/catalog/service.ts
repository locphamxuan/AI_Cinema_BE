import { MovieRepository, SeasonRepository, EpisodeRepository, GenreRepository } from "./repository";

// TODO: triển khai business logic cho Movie.
export class MovieService {
  constructor(private readonly repository: MovieRepository = new MovieRepository()) {}
}

// TODO: triển khai business logic cho Season.
export class SeasonService {
  constructor(private readonly repository: SeasonRepository = new SeasonRepository()) {}
}

// TODO: triển khai business logic cho Episode.
export class EpisodeService {
  constructor(private readonly repository: EpisodeRepository = new EpisodeRepository()) {}
}

// TODO: triển khai business logic cho Genre.
export class GenreService {
  constructor(private readonly repository: GenreRepository = new GenreRepository()) {}
}
