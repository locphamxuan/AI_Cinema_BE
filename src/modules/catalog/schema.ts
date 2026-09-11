import { z } from "zod";

// TODO: định nghĩa DTO create/update cho Movie dựa trên model Prisma tương ứng.
export const createMovieSchema = z.object({});
export const updateMovieSchema = z.object({});
export type CreateMovieInput = z.infer<typeof createMovieSchema>;
export type UpdateMovieInput = z.infer<typeof updateMovieSchema>;

// TODO: định nghĩa DTO create/update cho Season dựa trên model Prisma tương ứng.
export const createSeasonSchema = z.object({});
export const updateSeasonSchema = z.object({});
export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;

// TODO: định nghĩa DTO create/update cho Episode dựa trên model Prisma tương ứng.
export const createEpisodeSchema = z.object({});
export const updateEpisodeSchema = z.object({});
export type CreateEpisodeInput = z.infer<typeof createEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof updateEpisodeSchema>;

// TODO: định nghĩa DTO create/update cho Genre dựa trên model Prisma tương ứng.
export const createGenreSchema = z.object({});
export const updateGenreSchema = z.object({});
export type CreateGenreInput = z.infer<typeof createGenreSchema>;
export type UpdateGenreInput = z.infer<typeof updateGenreSchema>;
