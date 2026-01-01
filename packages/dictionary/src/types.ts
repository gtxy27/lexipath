import { z } from 'zod';

export const WordEntrySchema = z.object({
  word: z.string(),
  phonetic: z.string().optional(),
  definitions: z.array(
    z.object({
      partOfSpeech: z.string(),
      definition: z.string(),
      examples: z.array(z.string()).optional(),
    })
  ),
  difficulty: z.string().optional(),
  frequency: z.number().optional(),
});

export type WordEntry = z.infer<typeof WordEntrySchema>;

export interface DictionaryConfig {
  dbName: string;
  storeName: string;
  version: number;
}
