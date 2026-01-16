import { z } from 'zod';
import {
  CEFRLevelSchema,
  NativeLanguageSchema,
  SupportedLanguageSchema,
  type ExplainWordOutput,
} from '@lexipath/core';
import type { ChatProvider } from '../llm/openai-compatible';


export const ExplainWordRequestSchema = z
  .object({
    word: z.string().min(1),
    context: z.string().min(1).optional(),
    sourceLang: SupportedLanguageSchema,
    targetLang: NativeLanguageSchema,
    userLevel: CEFRLevelSchema,
  })
  .strict();

export type ExplainWordRequest = z.infer<typeof ExplainWordRequestSchema>;

export type ExplainWordResult = ExplainWordOutput;

export type ExplainWordPromptBuilder = (request: ExplainWordRequest) => Promise<string> | string;

