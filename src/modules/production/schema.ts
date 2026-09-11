import { z } from "zod";

// TODO: định nghĩa DTO create/update cho ContentBrief dựa trên model Prisma tương ứng.
export const createContentBriefSchema = z.object({});
export const updateContentBriefSchema = z.object({});
export type CreateContentBriefInput = z.infer<typeof createContentBriefSchema>;
export type UpdateContentBriefInput = z.infer<typeof updateContentBriefSchema>;

// TODO: định nghĩa DTO create/update cho EpisodePackage dựa trên model Prisma tương ứng.
export const createEpisodePackageSchema = z.object({});
export const updateEpisodePackageSchema = z.object({});
export type CreateEpisodePackageInput = z.infer<typeof createEpisodePackageSchema>;
export type UpdateEpisodePackageInput = z.infer<typeof updateEpisodePackageSchema>;

// TODO: định nghĩa DTO create/update cho Review dựa trên model Prisma tương ứng.
export const createReviewSchema = z.object({});
export const updateReviewSchema = z.object({});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

// TODO: định nghĩa DTO create/update cho Publication dựa trên model Prisma tương ứng.
export const createPublicationSchema = z.object({});
export const updatePublicationSchema = z.object({});
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;
