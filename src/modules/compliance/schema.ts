import { z } from "zod";

// TODO: định nghĩa DTO create/update cho ComplianceCheck dựa trên model Prisma tương ứng.
export const createComplianceCheckSchema = z.object({});
export const updateComplianceCheckSchema = z.object({});
export type CreateComplianceCheckInput = z.infer<typeof createComplianceCheckSchema>;
export type UpdateComplianceCheckInput = z.infer<typeof updateComplianceCheckSchema>;

// TODO: định nghĩa DTO create/update cho AiContentLabel dựa trên model Prisma tương ứng.
export const createAiContentLabelSchema = z.object({});
export const updateAiContentLabelSchema = z.object({});
export type CreateAiContentLabelInput = z.infer<typeof createAiContentLabelSchema>;
export type UpdateAiContentLabelInput = z.infer<typeof updateAiContentLabelSchema>;
