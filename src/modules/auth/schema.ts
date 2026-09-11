import { z } from "zod";

// TODO: định nghĩa DTO create/update cho User dựa trên model Prisma tương ứng.
export const createUserSchema = z.object({});
export const updateUserSchema = z.object({});
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
