import { z } from 'zod';
import { SettingsSchema, WordFamiliaritySchema } from '@lexipath/core';

export const ChatSessionKindSchema = z.enum(['general', 'keyword', 'web', 'subtitle']);
export type ChatSessionKind = z.infer<typeof ChatSessionKindSchema>;

const ChatSessionSchemaV1 = z
  .object({
    sessionId: z.string().min(1),
    keyword: z.string(),
    conversationIndex: z.number().int().nonnegative(),
    createdAt: z.number(),
    lastAccessedAt: z.number(),
  })
  .strict();

const ChatSessionSchemaV2 = ChatSessionSchemaV1.extend({
  kind: ChatSessionKindSchema,
  label: z.string(),
  anchorKey: z.string(),
}).strict();

export const ChatSessionSchema = z
  .union([ChatSessionSchemaV2, ChatSessionSchemaV1])
  .transform((session) => {
    if ('kind' in session) return session;

    const keyword = session.keyword ?? '';
    const kind: ChatSessionKind = keyword.trim() ? 'keyword' : 'general';
    const label = kind === 'keyword' ? keyword : 'General';

    return {
      ...session,
      kind,
      label,
      anchorKey: '',
    };
  })
  .pipe(ChatSessionSchemaV2);

export const StorageExportSchema = z
  .object({
    version: z.string().min(1),
    exportedAt: z.number(),
    settings: SettingsSchema,
    sessions: z.array(ChatSessionSchema),
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
