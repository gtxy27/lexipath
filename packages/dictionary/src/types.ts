import { z } from 'zod';
import { SupportedLanguageSchema } from '@lexipath/core';

// =============================================================================
// Dictionary storage types (normalized IndexedDB schema)
// =============================================================================

export const DictionaryLanguageSchema = SupportedLanguageSchema;
export type DictionaryLanguage = z.infer<typeof DictionaryLanguageSchema>;

export const DictionaryWordSchema = z
  .object({
    id: z.number().int().nonnegative(),
    word: z.string().min(1),

    // Optional metadata depending on language/source.
    pos: z.string().min(1).optional(),
    phonetic: z.string().min(1).optional(),
    reading: z.string().min(1).optional(),
    difficulty: z.string().min(1).optional(),
    frequency: z.number().optional(),
  })
  .strict();
export type DictionaryWord = z.infer<typeof DictionaryWordSchema>;

export const LookupExplainSchema = z
  .object({
    word: z.string().min(1),
    definition: z.string().min(1),
    phonetic: z.string().min(1).optional(),
    difficulty: z.string().min(1).optional(),
    translation: z.string().min(1).optional(),
    example: z.string().min(1).optional(),
    example_translation: z.string().min(1).optional(),
  })
  .strict();
export type LookupExplain = z.infer<typeof LookupExplainSchema>;

export const LookupMetaSchema = z
  .object({
    origin: z.enum(['offline', 'cache']),
    provider: z.string().min(1).optional(),
    cachedAt: z.number().int().min(0).optional(),
    expiresAt: z.number().int().min(0).optional(),
  })
  .strict();
export type LookupMeta = z.infer<typeof LookupMetaSchema>;

export const LookupQuerySchema = z
  .object({
    word: z.string().min(1),
    fromLang: DictionaryLanguageSchema,
    toLang: DictionaryLanguageSchema,
  })
  .strict();
export type LookupQuery = z.infer<typeof LookupQuerySchema>;

export const LookupResultSchema = z
  .object({
    query: LookupQuerySchema,
    source: DictionaryWordSchema.nullable(),
    targets: z.array(DictionaryWordSchema),
    explain: LookupExplainSchema.optional(),
    meta: LookupMetaSchema,
  })
  .strict();
export type LookupResult = z.infer<typeof LookupResultSchema>;

export interface DictionaryConfig {
  dbName: string;
  version: number;
}

