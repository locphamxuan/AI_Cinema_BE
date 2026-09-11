import { z } from "zod";

// TODO: định nghĩa DTO create/update cho AiProvider dựa trên model Prisma tương ứng.
export const createAiProviderSchema = z.object({});
export const updateAiProviderSchema = z.object({});
export type CreateAiProviderInput = z.infer<typeof createAiProviderSchema>;
export type UpdateAiProviderInput = z.infer<typeof updateAiProviderSchema>;

// TODO: định nghĩa DTO create/update cho AiModel dựa trên model Prisma tương ứng.
export const createAiModelSchema = z.object({});
export const updateAiModelSchema = z.object({});
export type CreateAiModelInput = z.infer<typeof createAiModelSchema>;
export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>;

// TODO: định nghĩa DTO create/update cho GenerationJob dựa trên model Prisma tương ứng.
export const createGenerationJobSchema = z.object({});
export const updateGenerationJobSchema = z.object({});
export type CreateGenerationJobInput = z.infer<typeof createGenerationJobSchema>;
export type UpdateGenerationJobInput = z.infer<typeof updateGenerationJobSchema>;

// TODO: định nghĩa DTO create/update cho GeneratedAsset dựa trên model Prisma tương ứng.
export const createGeneratedAssetSchema = z.object({});
export const updateGeneratedAssetSchema = z.object({});
export type CreateGeneratedAssetInput = z.infer<typeof createGeneratedAssetSchema>;
export type UpdateGeneratedAssetInput = z.infer<typeof updateGeneratedAssetSchema>;
