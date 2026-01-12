import { z } from 'zod';
import { SettingsSchema, WordFamiliaritySchema } from '@lexipath/core';

export const StorageExportSchema = z
  .object({
    version: z.string().min(1),
    exportedAt: z.number(),
    settings: SettingsSchema,
    sessions: z.array(
      z
        .object({
          sessionId: z.string().min(1),
          keyword: z.string(),
          conversationIndex: z.number().int().nonnegative(),
          createdAt: z.number(),
          lastAccessedAt: z.number(),
        })
        .strict()
    ),
    messages: z.array(
      z
        .object({
          id: z.number().int().nonnegative(),
          sessionId: z.string().min(1),
          role: z.enum(['user', 'assistant']),
          content: z.string(),
          thinking: z.string().optional(),
          timestamp: z.number(),
        })
        .strict()
    ),
    familiarity: z.array(WordFamiliaritySchema),
  })
  .strict();

export type StorageExportData = z.infer<typeof StorageExportSchema>;

export type ChatSessionRecord = StorageExportData['sessions'][number];
export type ChatMessageRecord = Omit<StorageExportData['messages'][number], 'id'>;
export type ChatMessageRecordWithId = StorageExportData['messages'][number];
