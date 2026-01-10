import type { ExplainWordOutput } from '@lexipath/core';
import { parseExplainWordResponse } from '@lexipath/core/prompting';
import type { ChatOptions } from '../llm/openai-compatible';
import type { ChatProvider, ExplainWordPromptBuilder, ExplainWordRequest } from './types';

export class LLMDictionaryProvider {
  private readonly provider: ChatProvider;
  private readonly buildPrompt: ExplainWordPromptBuilder;
  private readonly defaultChatOptions: ChatOptions;

  constructor(options: { provider: ChatProvider; buildPrompt: ExplainWordPromptBuilder; defaultChatOptions?: ChatOptions }) {
    this.provider = options.provider;
    this.buildPrompt = options.buildPrompt;
    this.defaultChatOptions = options.defaultChatOptions ?? { temperature: 0.2, maxTokens: 350 };
  }

  async explainWord(request: ExplainWordRequest, chatOptions: ChatOptions = {}): Promise<ExplainWordOutput> {
    const word = request.word.trim();
    if (!word) {
      throw new Error('Invalid dictionary request: word is empty');
    }

    const prompt = await this.buildPrompt({ ...request, word });
    const response = await this.provider.chat([{ role: 'user', content: String(prompt) }], {
      ...this.defaultChatOptions,
      ...chatOptions,
    });

    const responseText = response.choices?.[0]?.message?.content ?? '';
    const parsed = parseExplainWordResponse(responseText);

    const definition = String(parsed.definition ?? '').trim();
    if (!definition) {
      throw new Error('Invalid dictionary response: definition is empty');
    }

    const output: ExplainWordOutput = {
      word,
      definition,
      ...(String(parsed.translation ?? '').trim() ? { translation: String(parsed.translation).trim() } : {}),
      ...(String(parsed.phonetic ?? '').trim() ? { phonetic: String(parsed.phonetic).trim() } : {}),
      ...(String(parsed.difficulty ?? '').trim() ? { difficulty: String(parsed.difficulty).trim() } : {}),
      ...(String(parsed.example ?? '').trim() ? { example: String(parsed.example).trim() } : {}),
      ...(String(parsed.example_translation ?? '').trim()
        ? { example_translation: String(parsed.example_translation).trim() }
        : {}),
    };

    return output;
  }
}
