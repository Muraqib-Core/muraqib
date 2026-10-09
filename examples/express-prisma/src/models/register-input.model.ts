// src/models/register-input.model.ts
import { z } from "zod";

export const registerInputSchema = z.object({
  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters long")
    .max(50, "Full name cannot exceed 50 characters"),
  email: z
    .string()
    .email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;