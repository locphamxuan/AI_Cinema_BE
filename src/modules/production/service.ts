import { ContentBriefRepository, EpisodePackageRepository, ReviewRepository, PublicationRepository } from "./repository";

// TODO: triển khai business logic cho ContentBrief.
export class ContentBriefService {
  constructor(private readonly repository: ContentBriefRepository = new ContentBriefRepository()) {}
}

// TODO: triển khai business logic cho EpisodePackage.
export class EpisodePackageService {
  constructor(private readonly repository: EpisodePackageRepository = new EpisodePackageRepository()) {}
}

// TODO: triển khai business logic cho Review.
export class ReviewService {
  constructor(private readonly repository: ReviewRepository = new ReviewRepository()) {}
}

// TODO: triển khai business logic cho Publication.
export class PublicationService {
  constructor(private readonly repository: PublicationRepository = new PublicationRepository()) {}
}
