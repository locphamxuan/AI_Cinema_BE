/** The parts of the API responses the e2e suite reads. */

export interface Row {
  id: string;
  status: string;
}

export interface Page<T> {
  data: T[];
}

export interface Plan extends Row {
  quotaAllocations: { allocationType: string; remainingAmount: string }[];
  quotaRequests: { status: string; decisionNote: string | null }[];
  episodePackages: { currentForEpisode: { productionStatus: string } | null }[];
}

export interface Project {
  id: string;
  status: string;
  remainingAiQuotaBudget: string;
  productionPlans: Plan[];
  milestones: Row[];
}

export interface Scene {
  id: string;
  description: string;
}

export interface EpisodePackage {
  id: string;
  packageVersion: number;
  streamUrl: string | null;
  subtitles: { language: string }[];
}

export interface Movie {
  id: string;
  episodes: { id: string; currentPackageId: string | null }[];
}
