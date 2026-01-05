import { z } from 'zod';
import { CEFRLevelSchema } from '../types';

export const PromptUserInfoSchema = z
  .object({
    motherTongue: z.string().min(1),
    targetLearningLanguage: z.string().min(1),
    cefrLevel: CEFRLevelSchema,
    levelReferenceLine: z.string().min(1).optional(),
  })
  .strict();

export const PromptContextInfoSchema = z
  .object({
    before: z.array(z.string().min(1)).default([]),
    after: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PromptTemplateInputSchema = z
  .object({
    role: z.string().min(1),
    scene: z.string().min(1),
    style: z.string().min(1),
    task: z.string().min(1),
    userInfo: PromptUserInfoSchema,
    contextInfo: PromptContextInfoSchema.optional(),
    userInput: z.string().min(1),
    outputFormat: z.string().min(1),
    outputNotes: z.string().min(1),
  })
  .strict();

