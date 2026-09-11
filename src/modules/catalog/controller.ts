import { MovieService, SeasonService, EpisodeService, GenreService } from "./service";

// TODO: triển khai handler cho từng endpoint của Movie.
export class MovieController {
  constructor(private readonly service: MovieService = new MovieService()) {}
}

// TODO: triển khai handler cho từng endpoint của Season.
export class SeasonController {
  constructor(private readonly service: SeasonService = new SeasonService()) {}
}

// TODO: triển khai handler cho từng endpoint của Episode.
export class EpisodeController {
  constructor(private readonly service: EpisodeService = new EpisodeService()) {}
}

// TODO: triển khai handler cho từng endpoint của Genre.
export class GenreController {
  constructor(private readonly service: GenreService = new GenreService()) {}
}
