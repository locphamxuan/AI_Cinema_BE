import { ContentBriefService, EpisodePackageService, ReviewService, PublicationService } from "./service";

// TODO: triển khai handler cho từng endpoint của ContentBrief.
export class ContentBriefController {
  constructor(private readonly service: ContentBriefService = new ContentBriefService()) {}
}

// TODO: triển khai handler cho từng endpoint của EpisodePackage.
export class EpisodePackageController {
  constructor(private readonly service: EpisodePackageService = new EpisodePackageService()) {}
}

// TODO: triển khai handler cho từng endpoint của Review.
export class ReviewController {
  constructor(private readonly service: ReviewService = new ReviewService()) {}
}

// TODO: triển khai handler cho từng endpoint của Publication.
export class PublicationController {
  constructor(private readonly service: PublicationService = new PublicationService()) {}
}
